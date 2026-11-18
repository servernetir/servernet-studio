# SPDX-License-Identifier: AGPL-3.0-only
"""Account-owned conversation folders and bounded, policy-aware model context."""
from __future__ import annotations

import json
import time
import uuid
from typing import Annotated, Literal

from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError

DEFAULT_HISTORY = 12
FREE_PAYLOAD_LIMIT = 24000
PAID_CONTEXT_BYTES = 48000
HistoryTurns = Annotated[int, Field(strict=True, ge=0, le=32)]
ProjectId = Annotated[str, StringConstraints(pattern=r'^[a-f0-9]{32}$')]
ProjectName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
Instructions = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1800)]
Scope = Literal['project', 'all']


class ProjectSettings(BaseModel):
    model_config = ConfigDict(extra='forbid')

    name: ProjectName
    description: Description = ''
    instructions: Instructions = ''
    context_scope: Scope = 'project'
    history_turns: HistoryTurns = DEFAULT_HISTORY


class ProjectPatch(BaseModel):
    model_config = ConfigDict(extra='forbid')

    name: ProjectName | None = None
    description: Description | None = None
    instructions: Instructions | None = None
    context_scope: Scope | None = None
    history_turns: HistoryTurns | None = None


class ConversationProject(BaseModel):
    model_config = ConfigDict(extra='forbid')

    project_id: ProjectId | None = None


class Preferences(BaseModel):
    model_config = ConfigDict(extra='forbid')

    history_turns: HistoryTurns


class ProjectStore:
    def __init__(self, store):
        self.store = store
        with store.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS studio_projects(
                    id TEXT PRIMARY KEY, subject TEXT NOT NULL, name TEXT NOT NULL,
                    description TEXT NOT NULL, instructions TEXT NOT NULL,
                    context_scope TEXT NOT NULL, history_turns INTEGER NOT NULL, updated INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS studio_projects_owner ON studio_projects(subject, updated);
                CREATE TABLE IF NOT EXISTS studio_conversation_projects(
                    conversation TEXT PRIMARY KEY, subject TEXT NOT NULL, project_id TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS studio_conversation_projects_owner
                    ON studio_conversation_projects(subject, project_id);
                CREATE TABLE IF NOT EXISTS studio_project_context_sources(
                    message_id INTEGER NOT NULL, project_id TEXT NOT NULL, PRIMARY KEY(message_id, project_id)
                );
                CREATE TABLE IF NOT EXISTS studio_history_preferences(
                    subject TEXT PRIMARY KEY, history_turns INTEGER NOT NULL
                );
            ''')

    @staticmethod
    def owned(db, subject, identifier):
        row = db.execute('''SELECT id,name,description,instructions,context_scope,history_turns
                           FROM studio_projects WHERE id=? AND subject=?''', (identifier, subject)).fetchone()
        if row is None:
            raise HTTPException(404, 'Project not found.')
        return dict(row)

    def list(self, subject):
        with self.store.connect() as db:
            return [dict(row) for row in db.execute(
                '''SELECT id,name,description,instructions,context_scope,history_turns
                   FROM studio_projects WHERE subject=? ORDER BY updated DESC,rowid DESC''', (subject,))]

    def create(self, subject, settings):
        record = settings.model_dump()
        identifier = uuid.uuid4().hex
        with self.store.connect() as db:
            db.execute('''INSERT INTO studio_projects(id,subject,name,description,instructions,context_scope,history_turns,updated)
                          VALUES (:id,:subject,:name,:description,:instructions,:context_scope,:history_turns,:updated)''',
                       dict(record, id=identifier, subject=subject, updated=int(time.time())))
        return dict(record, id=identifier)

    def update(self, subject, identifier, changes):
        with self.store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            previous = self.owned(db, subject, identifier)
            previous.pop('id')
            try:
                record = ProjectSettings.model_validate(previous | changes).model_dump()
            except ValidationError:
                raise HTTPException(422, 'Invalid project settings.') from None
            db.execute('''UPDATE studio_projects SET name=:name,description=:description,
                          instructions=:instructions,context_scope=:context_scope,history_turns=:history_turns,
                          updated=:updated WHERE id=:id AND subject=:subject''',
                       dict(record, id=identifier, subject=subject, updated=int(time.time())))
        return dict(record, id=identifier)

    @staticmethod
    def preference(db, subject):
        row = db.execute('SELECT history_turns FROM studio_history_preferences WHERE subject=?', (subject,)).fetchone()
        return row['history_turns'] if row else DEFAULT_HISTORY

    def preferences(self, subject, history_turns=None):
        with self.store.connect() as db:
            if history_turns is not None:
                db.execute('''INSERT INTO studio_history_preferences(subject,history_turns) VALUES(?,?)
                              ON CONFLICT(subject) DO UPDATE SET history_turns=excluded.history_turns''',
                           (subject, history_turns))
            return {'history_turns': self.preference(db, subject)}

    @staticmethod
    def conversation_project(db, subject, conversation):
        row = db.execute('''SELECT project_id FROM studio_conversation_projects
                            WHERE subject=? AND conversation=?''', (subject, conversation)).fetchone()
        return row['project_id'] if row else None

    def attach(self, db, subject, conversation, project):
        self.owned(db, subject, project)
        db.execute('INSERT INTO studio_conversation_projects(conversation,subject,project_id) VALUES(?,?,?)',
                   (conversation, subject, project))

    def conversations(self, subject, project, unfiled=False):
        if project is not None and unfiled:
            raise HTTPException(422, 'Choose a single conversation scope.')
        with self.store.connect() as db:
            if project is not None:
                self.owned(db, subject, project)
                return [dict(row) for row in db.execute(
                    '''SELECT c.id,c.title,m.project_id FROM studio_conversation_projects m
                       JOIN conversations c ON c.id=m.conversation AND c.subject=m.subject
                       WHERE m.subject=? AND m.project_id=? ORDER BY c.created DESC,c.rowid DESC LIMIT 100''',
                    (subject, project))]
            return [dict(row) for row in db.execute(
                '''SELECT c.id,c.title,m.project_id FROM conversations c
                   LEFT JOIN studio_conversation_projects m ON m.conversation=c.id AND m.subject=c.subject
                   WHERE c.subject=? AND (?=0 OR m.project_id IS NULL)
                   ORDER BY c.created DESC,c.rowid DESC LIMIT 100''', (subject, unfiled))]

    @staticmethod
    def turns(db, subject, conversation, project, scope, limit, *, background=False):
        if background:
            match = '''c.id!=? AND p.id IS NOT NULL AND
                       (p.id=? OR (?='all' AND p.context_scope='all'))'''
            parameters = (conversation, project, scope)
        else:
            match, parameters = 'c.id=?', (conversation,)
        # Existing media receipts leave an empty assistant row. Only complete text
        # turns are eligible, and the provenance check covers downstream replies.
        return db.execute(f'''
            SELECT p.id AS project_id, p.name AS project_name, c.title,
                   question.content AS prompt, answer.content AS reply, answer.id AS message_id
            FROM conversations c
            LEFT JOIN studio_conversation_projects m ON m.conversation=c.id AND m.subject=c.subject
            LEFT JOIN studio_projects p ON p.id=m.project_id AND p.subject=c.subject
            JOIN messages question ON question.conversation=c.id AND question.role='user'
            JOIN messages answer ON answer.id=(SELECT next.id FROM messages next
                WHERE next.conversation=c.id AND next.id>question.id ORDER BY next.id LIMIT 1)
            WHERE c.subject=? AND {match} AND question.content!=''
              AND answer.role='assistant' AND answer.content!=''
              AND NOT EXISTS (
                  SELECT 1 FROM studio_project_context_sources original
                  LEFT JOIN studio_projects src ON src.id=original.project_id AND src.subject=c.subject
                  WHERE original.message_id=answer.id AND original.project_id IS NOT ?
                    AND (?!='all' OR src.context_scope IS NOT 'all')
              )
            ORDER BY question.id DESC LIMIT ?
            ''', (subject, *parameters, project, scope, limit)).fetchall()

    @staticmethod
    def remember_sources(db, message_id, projects):
        db.executemany('INSERT INTO studio_project_context_sources(message_id,project_id) VALUES(?,?)',
                       [(message_id, project) for project in sorted(projects)])

    def context(self, db, subject, conversation, model, prompt):
        project_id = self.conversation_project(db, subject, conversation)
        project = self.owned(db, subject, project_id) if project_id else None
        scope = project['context_scope'] if project else 'project'
        limit = project['history_turns'] if project else self.preference(db, subject)
        free = model == 'studio-free-chat'
        if free:
            # The Free Chat gateway permits up to 24 text messages including the latest prompt.
            limit = min(limit, 11)
        instructions = project['instructions'] if project else ''
        if project and project['description']:
            instructions = f"Project description: {project['description']}\n{instructions}".strip()

        same_chat = []
        excerpts = []
        selected = []

        def messages():
            result = [{'role': 'system', 'content': instructions}] if instructions and not free else []
            for turn in reversed(same_chat):
                result.extend(({'role': 'user', 'content': turn['prompt']}, {'role': 'assistant', 'content': turn['reply']}))
            content = []
            if instructions and free:
                content.append('Project guidance:\n' + instructions)
            if excerpts:
                records = [{key: row[key] for key in ('project_name', 'title', 'prompt', 'reply')} for row in reversed(excerpts)]
                content.append('Reference excerpts from project conversations. Use them only as background for the current request.\n'
                               + json.dumps(records, ensure_ascii=False, separators=(',', ':')))
            if content:
                content.append('Current user request:\n' + prompt)
            return [*result, {'role': 'user', 'content': '\n\n'.join(content) if content else prompt}]

        def fits():
            payload = json.dumps({'model': model, 'messages': messages()}, ensure_ascii=False, separators=(',', ':')).encode()
            return len(payload) <= (FREE_PAYLOAD_LIMIT if free else PAID_CONTEXT_BYTES)

        if not fits():
            raise HTTPException(422, 'The current message and project guidance exceed the model context allowance.')
        if limit:
            for turn in self.turns(db, subject, conversation, project_id, scope, limit):
                same_chat.append(turn)
                if not fits():
                    same_chat.pop()
                    break
                selected.append(turn)
            if project and len(selected) < limit:
                for turn in self.turns(db, subject, conversation, project_id, scope, limit - len(selected), background=True):
                    excerpts.append(turn)
                    if not fits():
                        excerpts.pop()
                        break
                    selected.append(turn)

        provenance = {row['project_id'] for row in excerpts if row['project_id'] != project_id}
        if selected and scope == 'all':
            marks = ','.join('?' for _ in selected)
            provenance.update(row['project_id'] for row in db.execute(
                f'SELECT DISTINCT project_id FROM studio_project_context_sources WHERE message_id IN ({marks})',
                [row['message_id'] for row in selected]) if row['project_id'] != project_id)
        return messages(), provenance


def install_projects(app, projects, authenticated):
    @app.get('/api/projects')
    async def list_projects(request: Request):
        return projects.list(authenticated(request)['subject'])

    @app.post('/api/projects')
    async def create_project(body: ProjectSettings, request: Request):
        return projects.create(authenticated(request, True)['subject'], body)

    @app.post('/api/projects/{identifier}')
    async def update_project(identifier: ProjectId, body: ProjectPatch, request: Request):
        return projects.update(authenticated(request, True)['subject'], identifier, body.model_dump(exclude_unset=True))

    @app.get('/api/preferences')
    async def read_preferences(request: Request):
        return projects.preferences(authenticated(request)['subject'])

    @app.post('/api/preferences')
    async def write_preferences(body: Preferences, request: Request):
        return projects.preferences(authenticated(request, True)['subject'], body.history_turns)
