# Valid Person Finder: OSINT Intelligence Pipeline

This is an automated Python and React application specialized in finding highly accurate contacts and executives at companies by executing zero-cost programmatic DuckDuckGo heuristic Intelligence (OSINT).

## Architecture
1. **Frontend**: React interface with a single and batch-processing flow, visualizing confidence percentages, live intelligence logs, and export pipelines.
2. **Backend**: Python FastAPI service utilizing `duckduckgo-search` to fetch real search engine snippets, perform Regular Expression Heuristic NLP, scrape deeper sites using BeautifulSoup, and cross-validate names with at least 2 independent sources before returning results.

---

## 🚀 Setup Instructions

### Environment Setup
All API keys or confidential model names must be stored securely locally.

1. **Create an Environment File**:
   Copy `.env.example` into `.env` at the root folder:
   ```bash
   cp .env.example .env
   ```
2. **Configure your Variables**:
   In the new `.env` file, ensure API variables (if you choose to pivot back to LLM integrations later) are set.
   *Note: As of the latest update, the application relies purely on programmatic web scraping and heuristic rules to save API costs and prevent scraping blocks, rendering API keys optional, but environment configuration is still supported.*

---

## 🏃 Running the Project Locally

### 1. Python Backend Service
The backend is responsible for all OSINT gathering, scraping, and verification.
1. Make sure you have python installed.
2. Navigate into the folder, optionally create a virtual environment, and install pip requirements:
    ```bash
    python -m pip install -r backend/requirements.txt
    ```
3. Start the FastAPI development server:
    ```bash
    uvicorn backend.main:app --host localhost --port 8000 --reload
    ```
   *The backend will now be scraping and validating on `http://localhost:8000/api/search`.*

### 2. React Frontend Application
The frontend consumes the FastAPI search endpoint.
1. Install node dependencies:
    ```bash
    npm install
    ```
2. Start the React server:
    ```bash
    npm start
    ```
   *The frontend will open directly in `http://localhost:3000`.*

---

## 🔍 Search & Cross-Validation Methodology
- The backend generates 3 different semantic queries per searched Company/Title pair.
- The tool extracts potential candidate names from LinkedIn Profile URLs, Wikipedia, Crunchbase, etc.
- **Cross-Validation Layer**: The primary validation engine extracts an array of names from the data set. It then filters candidates ensuring their name physically surfaced on **at least two entirely independent source URLs/domains**. The candidate with the highest cross-domain verification is confirmed via JSON.
