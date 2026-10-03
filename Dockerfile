FROM python:3.14-slim

# Install minimal build tools required for tree-sitter C bindings
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source code
COPY core/ ./core/
COPY api.py .

# Create writable data directory for SQLite databases
RUN mkdir -p /app/data && chmod 777 /app/data

ENV PYTHONUNBUFFERED=1
ENV PORT=8000

EXPOSE 8000

CMD ["uvicorn", "api.py:app", "--host", "0.0.0.0", "--port", "8000"]