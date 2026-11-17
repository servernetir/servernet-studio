FROM node:24-slim AS frontend
WORKDIR /build
COPY servernet/web/package*.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY servernet/web/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY servernet/hosted/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home studio && mkdir /data && chown studio:studio /data
COPY servernet/hosted/ /app/servernet/hosted/
COPY --from=frontend /build/dist/ /app/servernet/web/dist/
USER 10001
EXPOSE 8787
CMD ["uvicorn", "servernet.hosted.app:configured_app", "--factory", "--host", "0.0.0.0", "--port", "8787", "--no-access-log"]
