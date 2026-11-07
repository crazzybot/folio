FROM python:3.13-slim

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ENV UV_SYSTEM_PYTHON=1 \
    UV_COMPILE_BYTECODE=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY app/ ./app/

# Don't run as root; the workspace mount is read-only anyway. /data holds
# highlights (MARKDOWN_DATA_DIR): a named volume there starts out owned by app
RUN useradd --system --no-create-home --uid 10001 app \
    && mkdir /data && chown app:app /data
USER app

EXPOSE 8000

# Listens on all interfaces inside the container; docker-compose doesn't
# publish the port, so only nginx on the compose network can reach it.
CMD ["/app/.venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
