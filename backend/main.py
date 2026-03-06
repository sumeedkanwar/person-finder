import os
import time
import asyncio
import re
import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from duckduckgo_search import DDGS
from pydantic import BaseModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SearchRequest(BaseModel):
    company: str
    designation: str

request_lock = asyncio.Lock()
last_request_time = 0

async def rate_limited_search(query: str, max_results=5):
    global last_request_time
    async with request_lock:
        now = time.time()
        if now - last_request_time < 2:
            await asyncio.sleep(2 - (now - last_request_time))
        
        try:
            results = DDGS().text(query, max_results=max_results)
            last_request_time = time.time()
            return list(results)
        except Exception as e:
            last_request_time = time.time()
            print(f"DDG error on '{query}': {e}")
            return []

def extract_name_from_linkedin_title(title: str):
    # E.g. "John Doe - Chief Executive Officer - TechCorp | LinkedIn"
    parts = title.split(" - ")
    if len(parts) > 0:
        name_part = parts[0].strip()
        words = name_part.split()
        if 2 <= len(words) <= 4 and all(w.isalpha() or w.replace("-", "").isalpha() for w in words):
            return name_part
            
    # Also handle pipe splits just in case
    parts = title.split(" | ")
    if len(parts) > 0:
        name_part = parts[0].strip()
        words = name_part.split()
        if 2 <= len(words) <= 4 and all(w.isalpha() or w.replace("-", "").isalpha() for w in words):
            return name_part
            
    return None

def heuristic_name_extraction(snippet: str, designation: str, company: str):
    # E.g. "TechCorp CEO John Doe said..."
    # E.g. "John Doe is the CEO of TechCorp..."
    patterns = [
        # designation followed by name (e.g., CEO John Doe)
        r"(?i:\b" + re.escape(designation) + r"\b)\s+([A-Z][a-z]+ [A-Z][A-Za-z]+)",
        # Name followed by "is the <designation>"
        r"([A-Z][a-z]+ [A-Z][A-Za-z]+)\s+(?:is|was)\s+(?:the\s+)?(?i:\b" + re.escape(designation) + r"\b)",
        # Name, <designation> of
        r"([A-Z][a-z]+ [A-Z][A-Za-z]+)[,\s]+(?i:\b" + re.escape(designation) + r"\b)"
    ]
    for p in patterns:
        m = re.search(p, snippet)
        if m:
            return m.group(1).strip()
    return None

def determine_source_name(url: str):
    domain = urlparse(url).netloc.lower()
    if 'linkedin.com' in domain:
        return 'LinkedIn'
    elif 'wikipedia.org' in domain:
        return 'Wikipedia'
    elif 'crunchbase.com' in domain:
        return 'Crunchbase'
    elif 'bloomberg.com' in domain or 'forbes.com' in domain or 'reuters.com' in domain or 'cnbc.com' in domain:
        return 'News Article'
    return domain

@app.post("/api/search")
async def search_person(req: SearchRequest):
    queries = [
        f'"{req.company}" {req.designation} name LinkedIn',
        f'{req.company} {req.designation} site:crunchbase.com OR site:wikipedia.org',
        f'"{req.company}" "{req.designation}" executive name -jobs'
    ]
    
    all_results = []
    
    for q in queries:
        res = await rate_limited_search(q, max_results=5)
        all_results.extend([{"query": q, **r} for r in res])
        
    if not all_results:
        return {
            "notFound": True,
            "reasoning": "No search results found.",
            "confidence": 0.0,
            "firstName": None,
            "lastName": None,
            "currentTitle": None,
            "sourceUrl": None,
            "sourceName": None,
            "allSources": [],
            "queryUsed": "",
            "searchLogs": [f"Performed searches, but no results were returned from DuckDuckGo API."]
        }
    
    candidate_name = None
    candidate_url = None
    candidate_source_name = None
    candidate_confidence = 0.0
    candidate_reasoning = ""
    candidate_title = req.designation
    
    search_logs = [f"Generated {len(queries)} OSINT query variations.", "Executing heuristic NLP extraction on snippets (No LLM)."]
    
    # Priority 1: LinkedIn profiles (very structured titles)
    for r in all_results:
        url = r.get('href', '')
        title = r.get('title', '')
        snippet = r.get('body', '')
        
        if 'linkedin.com/in/' in url:
            name = extract_name_from_linkedin_title(title)
            if name:
                # Discard obviously bad names
                lower_name = name.lower()
                if "profile" in lower_name or "linkedin" in lower_name:
                    continue
                
                candidate_name = name
                candidate_url = url
                candidate_source_name = 'LinkedIn'
                candidate_confidence = 1.0
                candidate_reasoning = "Extracted robustly from LinkedIn profile title format."
                search_logs.append(f"Primary Validation: Found name {name} on LinkedIn.")
                break
                
    # Priority 2: Semantic Heuristics searching over ALL snippets
    if not candidate_name:
        search_logs.append("No explicit LinkedIn profiles found. Proceeding to semantic snippet parsing.")
        for r in all_results:
            url = r.get('href', '')
            title = r.get('title', '')
            snippet = r.get('body', '')
            
            name = heuristic_name_extraction(snippet, req.designation, req.company)
            # If not in snippet, try title
            if not name:
                name = heuristic_name_extraction(title, req.designation, req.company)
                
            if name:
                candidate_name = name
                candidate_url = url
                candidate_source_name = determine_source_name(url)
                
                if candidate_source_name in ['Crunchbase', 'Wikipedia', 'News Article']:
                    candidate_confidence = 0.8
                else:
                    candidate_confidence = 0.6
                    
                candidate_reasoning = f"Heuristic snippet extraction identified name adjacent to designation."
                search_logs.append(f"Secondary Validation: Found name {name} from {candidate_source_name}.")
                break
    
    # Priority 3 (if specifically requested): Use BeautifulSoup for non-linkedin URLs
    if not candidate_name:
        search_logs.append("Attempting deep-dive scraping on top non-LinkedIn result using BeautifulSoup.")
        try:
            # Grab top result that is not linkedin
            top_urls = [r.get('href') for r in all_results if 'linkedin.com' not in r.get('href')][:1]
            if top_urls:
                target_url = top_urls[0]
                headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
                html_resp = requests.get(target_url, headers=headers, timeout=5)
                soup = BeautifulSoup(html_resp.text, 'html.parser')
                
                # Check <title> and <h1> for name patterns
                title_text = soup.title.string if soup.title else ""
                h1_text = " ".join([h.get_text() for h in soup.find_all('h1')])
                
                combined_text = title_text + " " + h1_text
                name = heuristic_name_extraction(combined_text, req.designation, req.company)
                
                if name:
                    candidate_name = name
                    candidate_url = target_url
                    candidate_source_name = determine_source_name(target_url)
                    candidate_confidence = 0.5
                    candidate_reasoning = "Extracted via BeautifulSoup direct page scrape of headers."
                    search_logs.append(f"Fallback Validation: Found name {name} directly on page headers.")
        except Exception as e:
            search_logs.append(f"BeautifulSoup fallback scrape failed: {str(e)}")
            
    if candidate_name:
        parts = candidate_name.split()
        first_name = parts[0]
        last_name = " ".join(parts[1:]) if len(parts) > 1 else ""
        return {
            "notFound": False,
            "firstName": first_name,
            "lastName": last_name,
            "currentTitle": candidate_title,
            "sourceUrl": candidate_url,
            "sourceName": candidate_source_name,
            "confidence": candidate_confidence,
            "allSources": [r['href'] for r in all_results][:5],
            "queryUsed": queries[0], 
            "reasoning": candidate_reasoning,
            "searchLogs": search_logs
        }
    
    return {
        "notFound": True,
        "reasoning": "Could not extract a credible name using heuristic matching across sources.",
        "confidence": 0.0,
        "firstName": None,
        "lastName": None,
        "currentTitle": None,
        "sourceUrl": None,
        "sourceName": None,
        "allSources": [],
        "queryUsed": "",
        "searchLogs": search_logs + ["Name extraction heuristics failed for all snippets."]
    }
