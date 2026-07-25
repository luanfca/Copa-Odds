FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY docker/requirements-sofa.txt /tmp/requirements-sofa.txt
RUN pip install --no-cache-dir -r /tmp/requirements-sofa.txt \
    && useradd --system --uid 10001 --create-home sofa

COPY scripts/sofascore_server.py /app/scripts/sofascore_server.py
RUN chown -R sofa:sofa /app

USER sofa

EXPOSE 54545

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:54545/health', timeout=8)"

CMD ["gunicorn", "--chdir", "/app/scripts", "--bind", "0.0.0.0:54545", "--workers", "1", "--threads", "4", "--timeout", "90", "sofascore_server:app"]
