import { useState, useRef } from "react";

import rawDataset from './dataset.json';

const DATASET = rawDataset.map(item => ({
  title: item["Title"] || item.title,
  company: item["Company Name"] || item.company
}));

const DESIGNATION_ALIASES = {
  CEO: ["Chief Executive Officer", "CEO", "Managing Director"],
  CFO: ["Chief Financial Officer", "CFO"],
  CTO: ["Chief Technology Officer", "CTO"],
  COO: ["Chief Operating Officer", "COO"],
  CMO: ["Chief Marketing Officer", "CMO"],
  Founder: ["Founder", "Co-Founder", "Founded by"],
  "Co-Founder": ["Co-Founder", "Cofounder", "Founder"],
  Director: ["Director", "Managing Director"],
  President: ["President", "Chairman"],
};

function buildAliases(designation) {
  const upper = designation.toUpperCase();
  for (const [key, vals] of Object.entries(DESIGNATION_ALIASES)) {
    if (
      designation.toLowerCase().includes(key.toLowerCase()) ||
      key.toLowerCase().includes(designation.toLowerCase())
    ) {
      return vals;
    }
  }
  return [designation];
}

function buildQueries(company, designation) {
  const aliases = buildAliases(designation);
  const queries = [];
  for (const alias of aliases.slice(0, 2)) {
    queries.push(`"${company}" ${alias} name LinkedIn`);
    queries.push(`${company} ${alias} site:linkedin.com OR site:crunchbase.com OR site:wikipedia.org`);
  }
  queries.push(`who is the ${designation} of ${company}`);
  return queries.slice(0, 3);
}

const SYSTEM_PROMPT = `You are an OSINT intelligence analyst specialized in finding real people at companies.
Given a company name and designation, you will:
1. Use web_search to find the person holding that role
2. Search at least 2-3 different query variations
3. Cross-validate the name across multiple sources
4. Extract first name, last name, current title, source URL
5. Assign a confidence score 0.0-1.0 based on:
   - 1.0: Name found on official company site or LinkedIn with title match
   - 0.8: Name found on Wikipedia, Crunchbase, news article
   - 0.6: Name found in search snippet, single source
   - 0.4: Name inferred from partial data
   - 0.0: Not found

CRITICAL: Respond ONLY with valid JSON, no markdown, no preamble. Use this exact schema:
{
  "firstName": "string or null",
  "lastName": "string or null",
  "currentTitle": "string or null",
  "sourceUrl": "string or null",
  "sourceName": "string (e.g. LinkedIn, Wikipedia, Company Website, Crunchbase, News Article)",
  "confidence": 0.0,
  "allSources": ["array of source URLs checked"],
  "queryUsed": "the search query that found the result",
  "reasoning": "brief 1-sentence explanation of how name was found",
  "notFound": false
}

If person cannot be found after searching, return: {"notFound": true, "reasoning": "explanation", "confidence": 0.0, "firstName": null, "lastName": null, "currentTitle": null, "sourceUrl": null, "sourceName": null, "allSources": [], "queryUsed": ""}`;

async function findPerson(company, designation, onLog) {
  onLog(`🔍 Initiating query generation for "${company}" - ${designation}...`);

  try {
    const response = await fetch("http://localhost:8000/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company, designation }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const result = await response.json();
    
    if (result.searchLogs) {
      result.searchLogs.forEach(log => onLog(`🌐 ${log}`));
    }
    
    result.company = company;
    result.designation = designation;
    result.timestamp = new Date().toISOString();

    return result;
  } catch (e) {
    return {
      notFound: true,
      reasoning: "Fetch failed to reach backend API.",
      confidence: 0,
      firstName: null,
      lastName: null,
      currentTitle: null,
      sourceUrl: null,
      sourceName: null,
      allSources: [],
      queryUsed: "",
      company,
      designation,
      timestamp: new Date().toISOString()
    };
  }
}

function ConfidenceBadge({ score }) {
  if (score === null || score === undefined) return null;
  const pct = Math.round(score * 100);
  const color =
    pct >= 80 ? "#00ff9d" : pct >= 60 ? "#ffd700" : pct >= 40 ? "#ff9500" : "#ff4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          width: 80,
          height: 6,
          background: "#1a2035",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
            transition: "width 1s ease",
          }}
        />
      </div>
      <span style={{ color, fontFamily: "monospace", fontSize: 13, fontWeight: 700 }}>
        {pct}%
      </span>
    </div>
  );
}

function ResultCard({ result, index }) {
  const [expanded, setExpanded] = useState(false);
  const found = !result.notFound && result.firstName;

  return (
    <div
      style={{
        background: "linear-gradient(135deg, #0d1526 0%, #0a1020 100%)",
        border: `1px solid ${found ? "#1e3a5f" : "#3a1e1e"}`,
        borderLeft: `3px solid ${found ? "#00b4ff" : "#ff4444"}`,
        borderRadius: 8,
        padding: "16px 20px",
        marginBottom: 12,
        animation: `fadeIn 0.4s ease ${index * 0.1}s both`,
      }}
    >
      <style>{`@keyframes fadeIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }`}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span style={{ color: "#4a9eff", fontSize: 11, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: 2 }}>
              {result.designation}
            </span>
            <span style={{ color: "#2a4a6a", fontSize: 11 }}>@</span>
            <span style={{ color: "#8ab4d4", fontSize: 11, fontFamily: "monospace" }}>{result.company}</span>
          </div>
          {found ? (
            <div style={{ fontSize: 22, fontWeight: 700, color: "#e8f4ff", fontFamily: "'Georgia', serif", letterSpacing: 0.5 }}>
              {result.firstName} {result.lastName}
            </div>
          ) : (
            <div style={{ fontSize: 16, color: "#ff6b6b", fontFamily: "monospace" }}>
              ⚠ Identity Not Confirmed
            </div>
          )}
          {result.currentTitle && (
            <div style={{ color: "#5a8aaa", fontSize: 13, marginTop: 2 }}>{result.currentTitle}</div>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: "#4a6a8a", fontSize: 11, marginBottom: 4, fontFamily: "monospace" }}>CONFIDENCE</div>
          <ConfidenceBadge score={result.confidence} />
        </div>
      </div>

      {result.sourceName && (
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#2a5a3a", fontSize: 11, background: "#0d2a1a", padding: "2px 8px", borderRadius: 3, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: 1 }}>
            {result.sourceName}
          </span>
          {result.sourceUrl && (
            <a href={result.sourceUrl} target="_blank" rel="noopener noreferrer"
              style={{ color: "#3a7abf", fontSize: 11, fontFamily: "monospace", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 300 }}>
              {result.sourceUrl.replace(/^https?:\/\//, "").substring(0, 50)}
              {result.sourceUrl.length > 50 ? "…" : ""}
            </a>
          )}
        </div>
      )}

      {result.reasoning && (
        <div style={{ marginTop: 8, color: "#5a7a9a", fontSize: 12, fontStyle: "italic" }}>
          {result.reasoning}
        </div>
      )}

      <button
        onClick={() => setExpanded(!expanded)}
        style={{ marginTop: 10, background: "none", border: "none", color: "#3a6a9a", fontSize: 11, cursor: "pointer", fontFamily: "monospace", padding: 0 }}
      >
        {expanded ? "▲ HIDE" : "▼ SHOW"} RAW JSON
      </button>

      {expanded && (
        <pre style={{ marginTop: 8, background: "#060e1a", borderRadius: 6, padding: 12, fontSize: 11, color: "#4a9eff", overflow: "auto", maxHeight: 200, fontFamily: "monospace", lineHeight: 1.6 }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}

function LogPanel({ logs }) {
  const ref = useRef(null);
  useState(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  });
  return (
    <div
      ref={ref}
      style={{
        background: "#060e1a",
        border: "1px solid #1a2a3a",
        borderRadius: 6,
        padding: 12,
        height: 160,
        overflowY: "auto",
        fontFamily: "monospace",
        fontSize: 12,
        lineHeight: 1.7,
      }}
    >
      {logs.length === 0 ? (
        <span style={{ color: "#2a4a5a" }}>// Agent logs will appear here...</span>
      ) : (
        logs.map((log, i) => (
          <div key={i} style={{ color: log.startsWith("✅") ? "#00ff9d" : log.startsWith("❌") ? "#ff4444" : log.startsWith("🔍") ? "#ffd700" : log.startsWith("🌐") ? "#4a9eff" : "#6a9abf" }}>
            {log}
          </div>
        ))
      )}
    </div>
  );
}

export default function App() {
  const [company, setCompany] = useState("");
  const [designation, setDesignation] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const [activeTab, setActiveTab] = useState("search");
  const [batchResults, setBatchResults] = useState([]);
  const [batchProgress, setBatchProgress] = useState(0);

  const addLog = (msg) => setLogs((prev) => [...prev, msg]);

  const handleSearch = async (e) => {
    e?.preventDefault();
    if (!company.trim() || !designation.trim()) return;
    setLoading(true);
    setLogs([]);
    addLog(`🚀 Initiating intelligence scan...`);
    addLog(`🏢 Target: ${company} | Role: ${designation}`);
    try {
      const result = await findPerson(company.trim(), designation.trim(), addLog);
      if (result.notFound || !result.firstName) {
        addLog(`❌ Subject not identified — insufficient public data`);
      } else {
        addLog(`✅ Subject confirmed: ${result.firstName} ${result.lastName} (${Math.round(result.confidence * 100)}% confidence)`);
      }
      setResults((prev) => [result, ...prev]);
    } catch (err) {
      addLog(`❌ Error: ${err.message}`);
    }
    setLoading(false);
  };

  const handleBatch = async () => {
    setBatchLoading(true);
    setBatchResults([]);
    setBatchProgress(0);
    setLogs([]);
    addLog(`📋 Starting batch scan of ${DATASET.length} targets...`);

    const res = [];
    for (let i = 0; i < DATASET.length; i++) {
      const { company, title } = DATASET[i];
      addLog(`\n[${i + 1}/${DATASET.length}] Scanning: ${company} — ${title}`);
      try {
        const result = await findPerson(company, title, addLog);
        res.push(result);
        if (result.firstName) {
          addLog(`✅ Found: ${result.firstName} ${result.lastName}`);
        } else {
          addLog(`❌ Not found for ${company}`);
        }
      } catch (err) {
        res.push({ company, designation: title, notFound: true, error: err.message, confidence: 0, firstName: null, lastName: null });
        addLog(`❌ Error: ${err.message}`);
      }
      setBatchProgress(((i + 1) / DATASET.length) * 100);
      setBatchResults([...res]);
      // Rate limiting pause between requests
      if (i < DATASET.length - 1) {
        addLog(`⏳ Rate limit pause...`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    addLog(`\n🏁 Batch complete. ${res.filter((r) => r.firstName).length}/${DATASET.length} subjects identified.`);
    setBatchLoading(false);
  };

  const exportJSON = () => {
    const data = activeTab === "batch" ? batchResults : results;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "person_finder_results.json";
    a.click();
  };

  return (
    <div style={{ minHeight: "100vh", background: "#040c18", color: "#c8d8e8", fontFamily: "'Courier New', monospace" }}>
      {/* Animated grid bg */}
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
        backgroundImage: "linear-gradient(rgba(0,180,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,180,255,0.03) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
      }} />

      <div style={{ position: "relative", zIndex: 1, maxWidth: 900, margin: "0 auto", padding: "32px 20px" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ fontSize: 11, color: "#1e4a6a", letterSpacing: 6, marginBottom: 8, textTransform: "uppercase" }}>
            OSINT Intelligence Pipeline
          </div>
          <h1 style={{ margin: 0, fontSize: 36, fontWeight: 700, letterSpacing: -1, color: "#e8f4ff", fontFamily: "Georgia, serif" }}>
            Valid{" "}
            <span style={{
              background: "linear-gradient(90deg, #00b4ff, #00ff9d)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            }}>
              Person
            </span>{" "}
            Finder
          </h1>
          <p style={{ color: "#3a6a8a", fontSize: 13, marginTop: 8 }}>
            Agentic web intelligence • Multi-source validation • Confidence scoring
          </p>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 2, marginBottom: 24, background: "#060e1a", borderRadius: 8, padding: 4 }}>
          {["search", "batch"].map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              style={{
                flex: 1, padding: "10px 0", border: "none", borderRadius: 6, cursor: "pointer",
                background: activeTab === tab ? "#0d2040" : "transparent",
                color: activeTab === tab ? "#4a9eff" : "#3a5a7a",
                fontSize: 12, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: 2,
                fontWeight: activeTab === tab ? 700 : 400,
                transition: "all 0.2s",
              }}>
              {tab === "search" ? "⌕ Single Search" : "⊞ Batch Dataset"}
            </button>
          ))}
        </div>

        {/* Single Search */}
        {activeTab === "search" && (
          <div>
            <div style={{ background: "#080f1e", border: "1px solid #1a2a3a", borderRadius: 10, padding: 24, marginBottom: 20 }}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: 2, minWidth: 200 }}>
                  <label style={{ display: "block", color: "#3a6a9a", fontSize: 11, letterSpacing: 2, marginBottom: 6, textTransform: "uppercase" }}>
                    Company Name
                  </label>
                  <input
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    placeholder="e.g. Facebook"
                    style={{
                      width: "100%", padding: "10px 14px", background: "#0d1a2e",
                      border: "1px solid #1e3a5a", borderRadius: 6, color: "#c8d8e8",
                      fontFamily: "monospace", fontSize: 14, boxSizing: "border-box",
                      outline: "none",
                    }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <label style={{ display: "block", color: "#3a6a9a", fontSize: 11, letterSpacing: 2, marginBottom: 6, textTransform: "uppercase" }}>
                    Designation
                  </label>
                  <input
                    value={designation}
                    onChange={(e) => setDesignation(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    placeholder="e.g. CEO"
                    style={{
                      width: "100%", padding: "10px 14px", background: "#0d1a2e",
                      border: "1px solid #1e3a5a", borderRadius: 6, color: "#c8d8e8",
                      fontFamily: "monospace", fontSize: 14, boxSizing: "border-box",
                      outline: "none",
                    }}
                  />
                </div>
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <button
                    onClick={handleSearch}
                    disabled={loading || !company.trim() || !designation.trim()}
                    style={{
                      padding: "10px 24px", background: loading ? "#0d2040" : "linear-gradient(135deg, #0050a0, #0080d0)",
                      border: "none", borderRadius: 6, color: loading ? "#3a6a8a" : "#e8f4ff",
                      fontFamily: "monospace", fontSize: 13, cursor: loading ? "not-allowed" : "pointer",
                      fontWeight: 700, letterSpacing: 1, transition: "all 0.2s",
                      whiteSpace: "nowrap",
                    }}>
                    {loading ? "SCANNING..." : "▶ SCAN"}
                  </button>
                </div>
              </div>
            </div>

            <LogPanel logs={logs} />

            {results.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ color: "#3a6a8a", fontSize: 11, letterSpacing: 2, textTransform: "uppercase" }}>
                    {results.length} Result{results.length !== 1 ? "s" : ""}
                  </span>
                  <button onClick={exportJSON} style={{ background: "none", border: "1px solid #1e3a5a", color: "#4a9eff", fontFamily: "monospace", fontSize: 11, padding: "4px 12px", borderRadius: 4, cursor: "pointer", letterSpacing: 1 }}>
                    ↓ EXPORT JSON
                  </button>
                </div>
                {results.map((r, i) => <ResultCard key={i} result={r} index={i} />)}
              </div>
            )}
          </div>
        )}

        {/* Batch Mode */}
        {activeTab === "batch" && (
          <div>
            <div style={{ background: "#080f1e", border: "1px solid #1a2a3a", borderRadius: 10, padding: 20, marginBottom: 20 }}>
              <div style={{ color: "#3a6a9a", fontSize: 11, letterSpacing: 2, marginBottom: 12, textTransform: "uppercase" }}>
                Dataset — {DATASET.length} Targets
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {DATASET.map((item, i) => {
                  const res = batchResults[i];
                  return (
                    <div key={i} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "8px 12px", background: "#0a1525", borderRadius: 6,
                      border: "1px solid #1a2a3a", flexWrap: "wrap", gap: 8,
                    }}>
                      <div>
                        <span style={{ color: "#5a9adf", fontSize: 12, fontWeight: 700 }}>{item.company}</span>
                        <span style={{ color: "#2a4a6a", fontSize: 12 }}> — </span>
                        <span style={{ color: "#7a9abf", fontSize: 12 }}>{item.title}</span>
                      </div>
                      <div style={{ fontSize: 12 }}>
                        {res ? (
                          res.firstName ? (
                            <span style={{ color: "#00ff9d" }}>
                              {res.firstName} {res.lastName}{" "}
                              <span style={{ color: "#2a6a4a" }}>({Math.round(res.confidence * 100)}%)</span>
                            </span>
                          ) : (
                            <span style={{ color: "#ff6b6b" }}>Not found</span>
                          )
                        ) : batchLoading && i === batchProgress / (100 / DATASET.length) - 1 ? (
                          <span style={{ color: "#ffd700" }}>Scanning...</span>
                        ) : (
                          <span style={{ color: "#2a4a5a" }}>Pending</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {batchLoading && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ width: "100%", height: 4, background: "#0d1a2e", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${batchProgress}%`, height: "100%", background: "linear-gradient(90deg, #0050a0, #00b4ff)", transition: "width 0.5s" }} />
                  </div>
                  <div style={{ color: "#3a6a8a", fontSize: 11, marginTop: 4, textAlign: "right" }}>{Math.round(batchProgress)}%</div>
                </div>
              )}
              <button
                onClick={handleBatch}
                disabled={batchLoading}
                style={{
                  marginTop: 16, width: "100%", padding: "12px 0",
                  background: batchLoading ? "#0d2040" : "linear-gradient(135deg, #003a7a, #0070b8)",
                  border: "none", borderRadius: 6, color: batchLoading ? "#3a6a8a" : "#e8f4ff",
                  fontFamily: "monospace", fontSize: 13, cursor: batchLoading ? "not-allowed" : "pointer",
                  fontWeight: 700, letterSpacing: 2,
                }}>
                {batchLoading ? `SCANNING... (${batchResults.length}/${DATASET.length})` : "▶▶ RUN BATCH INTELLIGENCE SCAN"}
              </button>
            </div>

            <LogPanel logs={logs} />

            {batchResults.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ color: "#3a6a8a", fontSize: 11, letterSpacing: 2, textTransform: "uppercase" }}>
                    {batchResults.filter((r) => r.firstName).length}/{batchResults.length} Identified
                  </span>
                  <button onClick={exportJSON} style={{ background: "none", border: "1px solid #1e3a5a", color: "#4a9eff", fontFamily: "monospace", fontSize: 11, padding: "4px 12px", borderRadius: 4, cursor: "pointer", letterSpacing: 1 }}>
                    ↓ EXPORT JSON
                  </button>
                </div>
                {batchResults.map((r, i) => <ResultCard key={i} result={r} index={i} />)}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: 48, textAlign: "center", color: "#1e3a5a", fontSize: 11, letterSpacing: 1 }}>
          AGENTIC OSINT PIPELINE • MULTI-SOURCE VALIDATION • AI DRIVEN
        </div>
      </div>
    </div>
  );
}
