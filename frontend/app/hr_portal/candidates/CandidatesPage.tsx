"use client";
import "./CandidatesPage.css";
import { useEffect, useState } from "react";
import {
  Search, Star, X, RefreshCw,
  Briefcase, Award, TrendingUp, CheckCircle,
  Mail, Send,
} from "lucide-react";

type Candidate = {
  initials: string; color: string; name: string; role: string; score: number;
  stage: string; tags: string[]; yoe: string; email: string;
  summary: string;
  experience: { company: string; title: string; duration: string }[];
  skills: { name: string; level: number }[];
  dimensions: { label: string; score: number }[];
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

function initialsOf(name: string) {
  const parts = (name || "Candidate").trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0]?.slice(0, 2).toUpperCase() || "CA";
}

function avatarColor(name: string) {
  const palette = ["#8b5cf6", "#2563eb", "#0891b2", "#10b981", "#f59e0b", "#ef4444"];
  let hash = 0;
  for (let i = 0; i < (name || "Candidate").length; i += 1) {
    hash = (hash * 31 + (name || "Candidate").charCodeAt(i)) % palette.length;
  }
  return palette[hash];
}

function normalizeSkills(skills: unknown, score: number) {
  const fallback = Math.max(65, Math.min(98, score));

  if (Array.isArray(skills)) {
    return skills
      .map((skill, index) => {
        if (typeof skill === "string") {
          const name = skill.trim();
          return name ? { name, level: Math.max(60, Math.min(98, fallback - index * 2)) } : null;
        }
        if (skill && typeof skill === "object" && "name" in skill) {
          const typedSkill = skill as { name?: string; level?: number };
          return typedSkill.name
            ? { name: typedSkill.name, level: Math.max(60, Math.min(98, typedSkill.level ?? fallback)) }
            : null;
        }
        return null;
      })
      .filter(Boolean) as { name: string; level: number }[];
  }

  if (typeof skills === "string") {
    return skills
      .split(",")
      .map((item, index) => {
        const name = item.trim();
        return name ? { name, level: Math.max(60, Math.min(98, fallback - index * 2)) } : null;
      })
      .filter(Boolean) as { name: string; level: number }[];
  }

  return [{ name: "Core Skills", level: fallback }];
}

function normalizeCandidate(raw: any): Candidate {
  const score = Math.max(0, Math.min(100, Number(raw.ai_score ?? raw.score ?? 0) || 0));
  const name = raw.name || "Unknown Candidate";
  const role = raw.role || raw.job_title || raw.position || "Candidate";
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter(Boolean).map(String)
    : (typeof raw.skills === "string"
        ? raw.skills.split(",").map((item: string) => item.trim()).filter(Boolean)
        : [role]);

  return {
    initials: (raw.initials || initialsOf(name)).toUpperCase(),
    color: raw.color || avatarColor(name),
    name,
    role,
    score,
    stage: raw.stage || (score >= 85 ? "Shortlisted" : "Review"),
    tags: tags.slice(0, 5),
    yoe: raw.yoe || "N/A",
    email: raw.email || "noreply@example.com",
    summary:
      raw.summary ||
      raw.analysis_summary ||
      `${name} is a strong candidate for the ${role} role. Review the AI match details and interview status in the dashboard.`,
    experience: Array.isArray(raw.experience)
      ? raw.experience
      : [],
    skills: normalizeSkills(raw.skills ?? tags, score),
    dimensions: [
      { label: "Skills", score: Math.min(99, Math.max(60, score + 2)) },
      { label: "Experience", score: Math.min(99, Math.max(60, score - 1)) },
      { label: "Communication", score: Math.min(99, Math.max(60, score - 3)) },
      { label: "Culture Fit", score: Math.min(99, Math.max(60, score + 1)) },
    ],
  };
}

const initCandidates: Candidate[] = [
  {
    initials:"SM", color:"#8b5cf6", name:"Sarah Mitchell",  role:"Senior Backend Engineer",
    score:94, stage:"Interview", tags:["Python","Kafka","AWS"],
    yoe:"8 yrs", email:"sarah.mitchell@email.com",
    summary:"Highly experienced backend engineer with deep expertise in distributed systems. Strong match on all technical dimensions — particularly system design and communication. Recommended for fast-track hiring.",
    experience:[{company:"Stripe",title:"Staff Engineer",duration:"2021 – Present"},{company:"Flipkart",title:"Senior Backend Engineer",duration:"2018 – 2021"},{company:"Infosys",title:"Software Engineer",duration:"2016 – 2018"}],
    skills:[{name:"Python",level:95},{name:"Kafka",level:90},{name:"AWS",level:88},{name:"System Design",level:92},{name:"PostgreSQL",level:80}],
    dimensions:[{label:"Skills",score:96},{label:"Experience",score:94},{label:"Education",score:88},{label:"Leadership",score:90},{label:"Culture Fit",score:92},{label:"Communication",score:95}],
  },
  {
    initials:"RK", color:"#f59e0b", name:"Rohan Kapoor",    role:"Product Designer",
    score:88, stage:"Interview", tags:["Figma","UX Research"],
    yoe:"5 yrs", email:"rohan.kapoor@email.com",
    summary:"Creative product designer with a strong portfolio in B2B SaaS. Excellent UX research skills and a collaborative working style.",
    experience:[{company:"Razorpay",title:"Senior Product Designer",duration:"2022 – Present"},{company:"Swiggy",title:"UI/UX Designer",duration:"2019 – 2022"}],
    skills:[{name:"Figma",level:97},{name:"UX Research",level:88},{name:"Prototyping",level:85},{name:"Design Systems",level:82},{name:"User Testing",level:80}],
    dimensions:[{label:"Skills",score:92},{label:"Experience",score:86},{label:"Education",score:84},{label:"Leadership",score:80},{label:"Culture Fit",score:90},{label:"Communication",score:88}],
  },
  {
    initials:"YT", color:"#10b981", name:"Yuki Tanaka",     role:"Frontend Engineer",
    score:81, stage:"Interview", tags:["React","TypeScript"],
    yoe:"4 yrs", email:"yuki.tanaka@email.com",
    summary:"Solid frontend engineer with a focus on performance and accessibility. Good TypeScript fundamentals. Interview scheduled for today — technical round pending.",
    experience:[{company:"Atlassian",title:"Frontend Engineer",duration:"2022 – Present"},{company:"Zoho",title:"Junior Developer",duration:"2020 – 2022"}],
    skills:[{name:"React",level:90},{name:"TypeScript",level:85},{name:"CSS/Tailwind",level:82},{name:"Next.js",level:78},{name:"Testing",level:70}],
    dimensions:[{label:"Skills",score:84},{label:"Experience",score:80},{label:"Education",score:78},{label:"Leadership",score:72},{label:"Culture Fit",score:85},{label:"Communication",score:82}],
  },
  {
    initials:"AL", color:"#ef4444", name:"Aisha Levi",      role:"Data Scientist",
    score:76, stage:"Interview", tags:["Python","ML","SQL"],
    yoe:"3 yrs", email:"aisha.levi@email.com",
    summary:"Promising data scientist with hands-on ML project experience. Needs further evaluation on leadership and communication dimensions.",
    experience:[{company:"Mu Sigma",title:"Data Scientist",duration:"2023 – Present"},{company:"TCS",title:"Data Analyst",duration:"2021 – 2023"}],
    skills:[{name:"Python",level:88},{name:"Machine Learning",level:80},{name:"SQL",level:85},{name:"TensorFlow",level:72},{name:"Data Viz",level:75}],
    dimensions:[{label:"Skills",score:82},{label:"Experience",score:74},{label:"Education",score:80},{label:"Leadership",score:65},{label:"Culture Fit",score:76},{label:"Communication",score:70}],
  },
  {
    initials:"MG", color:"#2563eb", name:"Marco Greco",     role:"DevOps Engineer",
    score:91, stage:"Interview", tags:["Kubernetes","Terraform"],
    yoe:"6 yrs", email:"marco.greco@email.com",
    summary:"Highly capable DevOps engineer with strong cloud-native expertise. Excellent match on infrastructure skills.",
    experience:[{company:"Thoughtworks",title:"Senior DevOps Engineer",duration:"2021 – Present"},{company:"HCL",title:"DevOps Engineer",duration:"2018 – 2021"}],
    skills:[{name:"Kubernetes",level:94},{name:"Terraform",level:90},{name:"AWS",level:88},{name:"CI/CD",level:92},{name:"Docker",level:95}],
    dimensions:[{label:"Skills",score:94},{label:"Experience",score:90},{label:"Education",score:85},{label:"Leadership",score:88},{label:"Culture Fit",score:90},{label:"Communication",score:86}],
  },
  {
    initials:"PS", color:"#0891b2", name:"Priya Sharma",    role:"Product Manager",
    score:85, stage:"Interview", tags:["Roadmapping","Agile"],
    yoe:"7 yrs", email:"priya.sharma@email.com",
    summary:"Experienced product manager with a strong track record in B2C and B2B products. Final round interview scheduled with the CEO.",
    experience:[{company:"Meesho",title:"Senior Product Manager",duration:"2020 – Present"},{company:"OYO",title:"Product Manager",duration:"2017 – 2020"}],
    skills:[{name:"Roadmapping",level:90},{name:"Agile / Scrum",level:88},{name:"Data Analysis",level:78},{name:"Stakeholder Mgmt",level:85},{name:"User Research",level:80}],
    dimensions:[{label:"Skills",score:88},{label:"Experience",score:86},{label:"Education",score:82},{label:"Leadership",score:84},{label:"Culture Fit",score:88},{label:"Communication",score:90}],
  },
];

type EmailModal = { candidate: Candidate; subject: string; body: string } | null;

function ScoreRing({ score }: { score: number }) {
  const r = 36; const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <svg width="90" height="90" viewBox="0 0 90 90">
      <circle cx="45" cy="45" r={r} fill="none" stroke="#ddeeff" strokeWidth="8" />
      <circle cx="45" cy="45" r={r} fill="none" stroke="url(#grad)" strokeWidth="8"
        strokeLinecap="round" strokeDasharray={`${dash} ${circ}`} strokeDashoffset={circ / 4}
        transform="rotate(-90 45 45)" style={{ transition:"stroke-dasharray 0.6s ease" }} />
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#80B2FF" /><stop offset="100%" stopColor="#9E74D0" />
        </linearGradient>
      </defs>
      <text x="45" y="49" textAnchor="middle" fontSize="18" fontWeight="700" fill="#1a2a40">{score}%</text>
    </svg>
  );
}

export default function CandidatesPage() {
  const [candidates, setCandidates] = useState<Candidate[]>(initCandidates);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [emailModal, setEmailModal] = useState<EmailModal>(null);
  const [sent, setSent] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All Roles");
  const [loading, setLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadCandidates() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/candidates?min_score=80`, { cache: "no-store" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Unable to load candidates from the backend.");
      }

      const nextCandidates = (data.candidates || []).map((item: unknown) => normalizeCandidate(item));
      setCandidates(nextCandidates.length ? nextCandidates : initCandidates);
      setSelected((current) => current
        ? nextCandidates.find((item: Candidate) => item.name === current.name && item.email === current.email) || null
        : null);
    } catch (err) {
      console.error("Failed to load candidates", err);
      setError("Could not load data from the backend. Showing sample candidates instead.");
      setCandidates(initCandidates);
    } finally {
      setLoading(false);
    }
  }

  async function analyzeFromSalesforce() {
    setIsAnalyzing(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/analyze-salesforce?score_threshold=80`, {
        method: "POST",
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Salesforce analysis failed.");
      }

      await loadCandidates();
    } catch (err) {
      console.error("Salesforce analysis failed", err);
      setError("Salesforce analysis could not be completed right now.");
    } finally {
      setIsAnalyzing(false);
    }
  }

  useEffect(() => {
    loadCandidates();
  }, []);

  function openEmail(c: Candidate) {
    setEmailModal({
      candidate: c,
      subject: `You've Been Shortlisted — ${c.role}`,
      body: `Dear ${c.name},\n\nThank you for applying for the ${c.role} position with us.\n\nWe are pleased to inform you that, after careful review of your profile and qualifications, you have been shortlisted for this role.\n\nOur recruitment team will reach out to you shortly with further details regarding the next steps in the hiring process.\n\nWe appreciate your interest in joining our organization and look forward to speaking with you soon.\n\nWarm regards,\nHR Recruitment Team`,
    });
    setSent(false);
  }

  async function handleSend() {
    if (!emailModal) return;

    setSent(true);

    try {
      const response = await fetch(
        `${API_BASE_URL}/candidates/send-email?candidate_email=${encodeURIComponent(emailModal.candidate.email)}`,
        { method: "POST" }
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Email delivery failed.");
      }

      setTimeout(() => setEmailModal(null), 1000);
    } catch (err) {
      console.error("Email send failed", err);
      setSent(false);
      setError("Email delivery failed. Please verify the backend email settings.");
    }
  }

  const allRoles = ["All Roles", ...Array.from(new Set(candidates.map(c => c.role))).sort()];

  const filtered = candidates.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) || c.role.toLowerCase().includes(search.toLowerCase());
    const matchesRole = roleFilter === "All Roles" || c.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  return (
    <div className="candidates">
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Candidates — Interview Stage</h1>
          <p className="page-sub">{candidates.length} in interview{loading ? " · loading" : ""}</p>
        </div>
        <div className="header-actions">
          <button className="btn-refresh" onClick={() => loadCandidates()} disabled={loading}>
            <RefreshCw size={13} /> {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button className="btn-salesforce" onClick={analyzeFromSalesforce} disabled={isAnalyzing}>
            {isAnalyzing ? "Analyzing..." : "⚡ Analyse from Salesforce"}
          </button>
        </div>
      </div>

      {error ? <p className="page-sub" style={{ color: "#ef4444", marginTop: "-6px" }}>{error}</p> : null}

      {/* ── Toolbar ── */}
      <div className="toolbar">
        <div className="search-box">
          <Search size={14} color="#9090B0" />
          <input placeholder="Search by name or role..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select
          value={roleFilter}
          onChange={e => setRoleFilter(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #dde0e8", fontSize: 13, color: "#444", background: "#fff", cursor: "pointer" }}
        >
          {allRoles.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {/* ── Table + side panel ── */}
      <div className={`cand-layout ${selected ? "panel-open" : ""}`}>
        <div className="card">
          <div className="table-scroll">
            <table className="cand-table">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Role</th>
                  <th>AI Score</th>
                  <th>Stage</th>
                  <th>Tags</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => (
                  <tr key={`${c.email}-${c.role}-${i}`} className={selected === c ? "row-active" : ""}>

                    {/* Candidate */}
                    <td>
                      <div className="cand-name-cell">
                        <div className="avatar" style={{ background: c.color }}>{c.initials}</div>
                        <button className="cand-name-link" onClick={() => setSelected(c)}>{c.name}</button>
                      </div>
                    </td>

                    {/* Role */}
                    <td className="cand-role">{c.role}</td>

                    {/* AI Score */}
                    <td>
                      <div className="score-cell">
                        <Star size={12} color="#f59e0b" fill="#f59e0b" />
                        <span className="score-val">{c.score}%</span>
                      </div>
                    </td>

                    {/* Stage */}
                    <td>
                      <span className="stage-badge interview-stage">{c.stage}</span>
                    </td>

                    {/* Tags */}
                    <td>
                      <div className="tags">
                        {c.tags.map(t => <span key={t} className="tag">{t}</span>)}
                      </div>
                    </td>

                    {/* Actions */}
                    <td>
                      <div className="row-actions">
                        <button className="btn-email" onClick={() => openEmail(c)}><Mail size={12} /> Email</button>
                        <button className="btn-view-sm" onClick={() => setSelected(c)}>View</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Detail panel ── */}
        {selected && (
          <div className="detail-panel">
            <div className="panel-header">
              <div className="panel-avatar" style={{ background: selected.color }}>{selected.initials}</div>
              <div className="panel-title-block">
                <h2 className="panel-name">{selected.name}</h2>
                <p className="panel-role">{selected.role}</p>
                <span className="stage-badge interview-stage">Interview</span>
              </div>
              <button className="close-btn" onClick={() => setSelected(null)}><X size={18} /></button>
            </div>

            <div className="panel-score-row">
              <ScoreRing score={selected.score} />
              <div className="panel-score-info">
                <div className="panel-score-label">AI Match Score</div>
                <div className="panel-score-sub">{selected.yoe} experience · {selected.tags.length} key skills matched</div>
                <div className={`panel-score-verdict ${selected.score >= 85 ? "strong" : selected.score >= 75 ? "good" : "fair"}`}>
                  {selected.score >= 85 ? "✓ Strong Match" : selected.score >= 75 ? "✓ Good Match" : "~ Fair Match"}
                </div>
              </div>
            </div>

            <div className="panel-section">
              <div className="panel-section-title"><Award size={14} /> AI Summary</div>
              <p className="panel-summary">{selected.summary}</p>
            </div>

            <div className="panel-section">
              <div className="panel-section-title"><TrendingUp size={14} /> Match Dimensions</div>
              <div className="dimensions">
                {selected.dimensions.map(d => (
                  <div key={d.label} className="dim-row">
                    <span className="dim-label">{d.label}</span>
                    <div className="dim-bar-wrap"><div className="dim-bar" style={{ width:`${d.score}%` }} /></div>
                    <span className="dim-score">{d.score}%</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel-section">
              <div className="panel-section-title"><CheckCircle size={14} /> Skills</div>
              <div className="skill-list">
                {selected.skills.map(s => (
                  <div key={s.name} className="skill-row">
                    <span className="skill-name">{s.name}</span>
                    <div className="skill-bar-wrap"><div className="skill-bar" style={{ width:`${s.level}%` }} /></div>
                    <span className="skill-pct">{s.level}%</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel-section">
              <div className="panel-section-title"><Briefcase size={14} /> Work Experience</div>
              <div className="exp-list">
                {selected.experience.map(e => (
                  <div key={e.company} className="exp-row">
                    <div className="exp-dot" />
                    <div>
                      <div className="exp-title">{e.title}</div>
                      <div className="exp-company">{e.company} · {e.duration}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="panel-actions">
              <button className="btn-reject">Reject</button>
              <button className="btn-email" onClick={() => openEmail(selected)}><Mail size={13} /> Email</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Email modal ── */}
      {emailModal && (
        <div className="modal-overlay" onClick={() => setEmailModal(null)}>
          <div className="email-modal" onClick={e => e.stopPropagation()}>
            <div className="email-modal-header">
              <div className="email-modal-title"><Mail size={16} color="#7a52b0" /><span>Send Email to {emailModal.candidate.name}</span></div>
              <button className="close-btn" onClick={() => setEmailModal(null)}><X size={18} /></button>
            </div>
            <div className="email-modal-body">
              <div className="email-to-row">
                <span className="email-field-label">To</span>
                <span className="email-to-value">{emailModal.candidate.email}</span>
              </div>
              <div className="email-form-group">
                <label className="email-field-label">Subject</label>
                <input className="email-input" value={emailModal.subject} onChange={e => setEmailModal({ ...emailModal, subject: e.target.value })} />
              </div>
              <div className="email-form-group">
                <label className="email-field-label">Message</label>
                <textarea className="email-textarea" rows={9} value={emailModal.body} onChange={e => setEmailModal({ ...emailModal, body: e.target.value })} />
              </div>
            </div>
            <div className="email-modal-footer">
              <button className="btn-outline" onClick={() => setEmailModal(null)}>Cancel</button>
              <button className={`btn-send ${sent ? "sent" : ""}`} onClick={handleSend}>
                {sent ? "✓ Sent!" : <><Send size={14} /> Send Email</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
