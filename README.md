# SOC Log Parser

A powerful Python-based tool to parse, sanitize, and analyze SOC (Security Operations Center) log files. This project integrates AI-powered regex generation to automatically infer log patterns, making log analysis faster and more reliable.

---

## Features

- **Automatic regex generation using AI**  
  Supports OpenAI, Claude, and Ollama providers for intelligent pattern recognition.

- **Sanitization & masking**  
  Removes sensitive data and masks confidential information before sending logs to AI providers.

- **Robust log sampling**  
  Extracts valid sample lines while skipping blank lines and comments.

- **Flexible AI response parsing**  
  Supports multiple AI output formats:
  - Clean JSON
  - Markdown fenced JSON
  - Embedded JSON in explanation text
  - Raw regex fallback
  - Already parsed Python dictionaries

- **Extensive test coverage**  
  Brutal test suite with 27 cases to ensure all log formats and edge cases are handled.

- **Extensible architecture**  
  Easily add new AI providers or extend regex handling.

---

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/soc-log-parser.git
cd soc-log-parser

Create and activate a virtual environment:

python -m venv venv
source venv/bin/activate  # Linux/macOS
venv\Scripts\activate     # Windows

Install dependencies:

pip install -r requirements.txt

Configure .env file:

AI_PROVIDER=claude  # Options: ollama, openai, claude
OPENAI_API_KEY=your_api_key_here
Usage

Example of generating regex from log lines:

import asyncio
from backend.ai.ai_engine import generate_regex_with_ai

log_lines = [
    "2026-03-17 16:30:01 host1 sshd[1234]: Accepted password for user1 from 192.168.0.1 port 54321 ssh2",
    "2026-03-17 16:31:12 host2 sshd[5678]: Failed password for root from 10.0.0.2 port 12345 ssh2"
]

async def main():
    result = await generate_regex_with_ai(log_lines)
    print(result)

asyncio.run(main())

Output:

{
  "regex": "(?P<timestamp>\\S+) (?P<hostname>\\S+) (?P<process>\\S+): (?P<message>.+)",
  "fields": ["timestamp", "hostname", "process", "message"]
}
Testing

Run the brutal test suite:

python test.py

All edge cases including empty fields, fenced JSON, embedded JSON, raw regex, and pre-parsed dicts are verified.

Project Structure
soc-log-parser/
├─ backend/
│  ├─ ai/
│  │  ├─ ai_engine.py        # Core AI pipeline
│  │  ├─ prompt_builder.py   # Prompt construction for AI
│  │  ├─ openai_provider.py
│  │  ├─ claude_provider.py
│  │  └─ ollama_provider.py
│  ├─ sanitizer/
│  │  └─ sanitizer.py        # Log sanitization utilities
│  ├─ middleware/
│  │  └─ security.py         # Masking of sensitive data
│  └─ utils/
│     └─ logger.py           # Logging wrapper
├─ test.py                   # Brutal AI parser tests
├─ requirements.txt
└─ .env.example
Contributing

Contributions are welcome! Please:

Fork the repository

Create a feature branch (git checkout -b feature-name)

Commit your changes (git commit -am 'Add feature')

Push to your branch (git push origin feature-name)

Open a Pull Request

License

MIT License © 2026