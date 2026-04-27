import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  FileText, 
  Upload, 
  Trash2, 
  AlertCircle, 
  CheckCircle2, 
  TrendingUp, 
  Users, 
  Target, 
  ChevronRight,
  ShieldAlert,
  Search,
  ArrowRight
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { recruitmentEngine } from './services/geminiService';
import { MultiCandidateAnalysis, CandidateEvaluation } from './types';
import { cn } from './lib/utils';

import * as pdfjsLib from 'pdfjs-dist';

// Use a local worker for polyfill-free operation
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

const extractText = async (file: File): Promise<string> => {
  if (file.type === 'application/pdf') {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      fullText += pageText + '\n';
    }
    return fullText;
  } else {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string || "");
      reader.readAsText(file);
    });
  }
};

export default function App() {
  const [jd, setJd] = useState('');
  const [resumes, setResumes] = useState<{ file: File; text: string }[]>([]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [result, setResult] = useState<MultiCandidateAnalysis | null>(null);
  const [activeCandidate, setActiveCandidate] = useState<number | null>(null);

  const onDropResumes = async (acceptedFiles: File[]) => {
    const newResumes = await Promise.all(
      acceptedFiles.map(async (file) => ({
        file,
        text: await extractText(file),
      }))
    );
    setResumes((prev) => [...prev, ...newResumes]);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDropResumes,
    accept: { 'text/plain': ['.txt'], 'application/pdf': ['.pdf'] },
    multiple: true
  });

  const handleEvaluate = async () => {
    if (!jd || resumes.length === 0) return;
    setIsEvaluating(true);
    setResult(null);
    try {
      const analysis = await recruitmentEngine.evaluateCandidates(
        jd,
        resumes.map((r) => r.text)
      );
      setResult(analysis);
      setActiveCandidate(0);
    } catch (error) {
      alert("Error evaluating. Please try again.");
    } finally {
      setIsEvaluating(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-emerald-500 border-emerald-500/20 bg-emerald-500/5';
    if (score >= 75) return 'text-blue-500 border-blue-500/20 bg-blue-500/5';
    if (score >= 60) return 'text-amber-500 border-amber-500/20 bg-amber-500/5';
    return 'text-rose-500 border-rose-500/20 bg-rose-500/5';
  };

  const getRecommendationStyle = (rec: string) => {
    switch (rec) {
      case 'STRONG HIRE': return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30';
      case 'HIRE': return 'bg-blue-500/10 text-blue-500 border-blue-500/30';
      case 'BORDERLINE': return 'bg-amber-500/10 text-amber-500 border-amber-500/30';
      default: return 'bg-rose-500/10 text-rose-500 border-rose-500/30';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex overflow-hidden">
      {/* Sidebar: Inputs - Re-styled as Professional Polish Sidebar */}
      <div className="w-[450px] bg-slate-900 border-r border-slate-800 h-screen overflow-y-auto p-8 sticky top-0 flex flex-col shrink-0">
        <div className="mb-10 flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-500/20">
            RE
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight text-white">RecruitIntel AI</h1>
            <p className="text-[10px] text-slate-500 font-mono tracking-widest uppercase">System Protocol // Active</p>
          </div>
        </div>

        <div className="space-y-8 flex-1">
          {/* JD Input */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-slate-500" />
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Job Description</h2>
            </div>
            <textarea
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              placeholder="Paste the raw job description here..."
              className="w-full h-48 p-4 bg-slate-800/50 border border-slate-700 rounded-xl text-sm text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none resize-none placeholder:text-slate-600"
            />
          </section>

          {/* Resume Uploads */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-slate-500" />
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Resume Queue ({resumes.length})</h2>
            </div>
            
            <div {...getRootProps()} className={cn(
              "border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer",
              isDragActive ? "border-indigo-500 bg-indigo-500/10" : "border-slate-800 hover:border-slate-700 bg-slate-800/20"
            )}>
              <input {...getInputProps()} />
              <Upload className="w-6 h-6 mx-auto mb-3 text-slate-600" />
              <p className="text-xs text-slate-500">Drop candidate resumes here</p>
              <p className="text-[10px] text-slate-600 mt-1 uppercase font-bold tracking-tighter">PDF / TEXT ONLY</p>
            </div>

            <div className="mt-4 space-y-2">
              {resumes.map((r, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-slate-800/40 rounded-lg border border-slate-800/50">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <FileText className="w-4 h-4 text-slate-600 shrink-0" />
                    <span className="text-[11px] truncate font-medium text-slate-300">{r.file.name}</span>
                  </div>
                  <button onClick={() => setResumes(prev => prev.filter((_, idx) => idx !== i))} className="text-slate-600 hover:text-rose-500 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>

        <button
          onClick={handleEvaluate}
          disabled={isEvaluating || !jd || resumes.length === 0}
          className="mt-8 w-full py-4 bg-indigo-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 shadow-xl shadow-indigo-600/20 transition-all disabled:bg-slate-800 disabled:text-slate-600 disabled:shadow-none disabled:cursor-not-allowed group"
        >
          {isEvaluating ? (
            <motion.div 
              animate={{ rotate: 360 }} 
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full"
            />
          ) : (
            <>
              ENGAGE MATCHING ENGINE
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </>
          )}
        </button>
      </div>

      {/* Main Content: Re-styled as Professional Polish Dashboard */}
      <main className="flex-1 overflow-y-auto bg-slate-50 pt-8 px-12 pb-12">
        <AnimatePresence mode="wait">
          {!result && !isEvaluating && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto"
            >
              <div className="w-20 h-20 bg-white shadow-2xl shadow-slate-200 border border-slate-200 rounded-3xl flex items-center justify-center mb-8">
                <Target className="w-10 h-10 text-indigo-500" />
              </div>
              <h2 className="text-3xl font-black mb-4 tracking-tight">Intelligence Ready</h2>
              <p className="text-slate-500 text-sm leading-relaxed font-medium">
                Upload candidate dossiers and target job parameters. The engine will perform evidence-based scoring and risk assessment.
              </p>
            </motion.div>
          )}

          {isEvaluating && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="h-full flex flex-col items-center justify-center"
            >
              <div className="w-48 h-1 bg-slate-200 rounded-full overflow-hidden mb-6">
                <motion.div 
                  initial={{ x: '-100%' }}
                  animate={{ x: '100%' }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                  className="w-full h-full bg-indigo-600"
                />
              </div>
              <h2 className="text-[11px] font-black font-mono tracking-[0.3em] text-slate-400 uppercase">Engine Processing Stack...</h2>
            </motion.div>
          )}

          {result && (
            <div className="max-w-6xl mx-auto space-y-10">
              {/* Header: JD Summary */}
              <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-6">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-1 block">Active Requirement</span>
                    <h2 className="text-3xl font-black tracking-tight">{result.jd_struct.roleTitle}</h2>
                    <div className="flex items-center gap-2 mt-3 overflow-x-auto no-scrollbar">
                      {result.jd_struct.toolsTechStack.slice(0, 8).map((t, i) => (
                        <span key={i} className="px-2 py-0.5 bg-slate-100 rounded text-[9px] font-black text-slate-500 uppercase tracking-tighter">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-[10px] font-bold text-slate-400 uppercase">Analysis Pool</div>
                      <div className="text-lg font-black">{result.candidates.length} Profiles</div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-8 pt-8 border-t border-slate-100">
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Scope Context</h3>
                    <div className="space-y-1">
                      <p className="text-xs font-bold text-slate-700 capitalize">{result.jd_struct.seniorityLevel} Level</p>
                      <p className="text-[11px] text-slate-500">{result.jd_struct.experienceRange} Experience</p>
                      <p className="text-[11px] text-slate-500">{result.jd_struct.domainIndustry}</p>
                    </div>
                  </div>
                  <div className="col-span-2 bg-indigo-50/30 p-4 rounded-xl border border-indigo-100/50">
                    <h3 className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3 h-3" />
                      Core Screening Metrics
                    </h3>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      {result.jd_struct.screeningCriteria.slice(0, 4).map((c, i) => (
                        <div key={i} className="text-[10px] text-indigo-800/70 font-bold flex items-center gap-2">
                          <span className="w-1 h-1 bg-indigo-300 rounded-full" />
                          {c}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Dashboard Grid */}
              <div className="grid grid-cols-12 gap-8 items-start">
                {/* Ranking Column */}
                <div className="col-span-4 space-y-4">
                  <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest pl-2">Live Matching Rank</h3>
                  {result.candidates.sort((a, b) => b.score - a.score).map((cand, idx) => {
                    const isSelected = activeCandidate === idx;
                    const scoreStyles = cand.score >= 90 ? 'border-emerald-500' : 
                                       cand.score >= 75 ? 'border-indigo-500' :
                                       cand.score >= 60 ? 'border-yellow-500' : 'border-rose-500';
                    
                    return (
                      <button
                        key={idx}
                        onClick={() => setActiveCandidate(idx)}
                        className={cn(
                          "w-full text-left p-5 rounded-xl border-l-4 shadow-sm transition-all flex flex-col gap-2 relative bg-white",
                          scoreStyles,
                          isSelected ? "ring-2 ring-indigo-600 shadow-md translate-x-1" : "border border-slate-200 opacity-80 hover:opacity-100"
                        )}
                      >
                        <div className="flex justify-between items-start">
                          <h4 className="font-black text-slate-900 leading-tight">{cand.name}</h4>
                          <span className={cn(
                            "font-mono font-black text-sm",
                            cand.score >= 90 ? 'text-emerald-600' : 
                            cand.score >= 75 ? 'text-indigo-600' :
                            cand.score >= 60 ? 'text-yellow-600' : 'text-rose-600'
                          )}>
                            {cand.score}/100
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                           <span className={cn(
                             "text-[9px] font-black px-2 py-0.5 rounded uppercase",
                             cand.score >= 90 ? 'bg-emerald-50 text-emerald-700' : 
                             cand.score >= 75 ? 'bg-indigo-50 text-indigo-700' :
                             cand.score >= 60 ? 'bg-yellow-50 text-yellow-700' : 'bg-rose-50 text-rose-700'
                           )}>
                             {cand.verdict}
                           </span>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Report Area */}
                <div className="col-span-8">
                  {activeCandidate !== null && (
                    <motion.div 
                      key={activeCandidate}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col"
                    >
                      {/* Detailed Header */}
                      <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/30">
                        <div>
                          <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">Candidate Evaluation Report</h2>
                          <p className="text-[10px] text-slate-400 mt-1 uppercase font-bold tracking-widest">
                            Intelligence Node: EVAL-{Math.random().toString(36).substring(7).toUpperCase()} | Subject: {result.candidates[activeCandidate].name}
                          </p>
                        </div>
                        <div className="text-center bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                          <div className={cn(
                            "text-3xl font-black leading-none",
                            result.candidates[activeCandidate].score >= 75 ? 'text-indigo-600' : 'text-slate-900'
                          )}>
                            {result.candidates[activeCandidate].score}
                          </div>
                          <div className="text-[9px] font-bold text-slate-400 uppercase mt-1">Match Score</div>
                        </div>
                      </div>

                      <div className="p-8 space-y-10">
                        {/* Executive Summary */}
                        <section>
                          <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4">Executive Summary</h3>
                          <p className="text-[14px] leading-relaxed text-slate-700 font-medium">
                            {result.candidates[activeCandidate].summary}
                          </p>
                        </section>

                        {/* Analysis Tables */}
                        <AnalysisTable 
                          title="Requirement Compliance (Must-Have)" 
                          skills={result.candidates[activeCandidate].mustHaveAnalysis} 
                          accent="border-slate-900"
                        />

                        {/* Flags Grid */}
                        <div className="grid grid-cols-2 gap-6">
                          <div className="bg-emerald-50/50 p-5 border border-emerald-100 rounded-xl">
                            <h4 className="text-[10px] font-black text-emerald-700 uppercase tracking-widest mb-3 flex items-center gap-2">
                              <CheckCircle2 className="w-3 h-3" />
                              Advantage Signals
                            </h4>
                            <ul className="text-[12px] text-emerald-900 font-medium space-y-2">
                              {result.candidates[activeCandidate].strengths.map((s, i) => (
                                <li key={i} className="flex items-start gap-2">
                                  <span className="mt-1.5 w-1 h-1 bg-emerald-400 rounded-full shrink-0" />
                                  {s}
                                </li>
                              ))}
                            </ul>
                          </div>

                          <div className="bg-slate-50 p-5 border border-slate-200 rounded-xl">
                            <h4 className="text-[10px] font-black text-slate-600 uppercase tracking-widest mb-3 flex items-center gap-2">
                              <ShieldAlert className="w-3 h-3 text-amber-500" />
                              Integrity Risk Analysis
                            </h4>
                            <div className="space-y-3">
                              <div className="flex items-center gap-2">
                                <span className={cn(
                                  "px-2 py-0.5 rounded text-[9px] font-black uppercase",
                                  result.candidates[activeCandidate].riskAssessment.level === 'Low' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'
                                )}>
                                  {result.candidates[activeCandidate].riskAssessment.level} Risk
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-600 leading-tight font-medium">
                                {result.candidates[activeCandidate].riskAssessment.justification}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Interview Focus */}
                        {result.candidates[activeCandidate].recommendation !== 'REJECT' && (
                          <section className="p-6 bg-indigo-50 border border-indigo-100 rounded-xl">
                             <h3 className="text-[11px] font-black text-indigo-600 uppercase tracking-widest mb-4">Tactical Interview Focus</h3>
                             <div className="flex flex-wrap gap-2">
                               {result.candidates[activeCandidate].interviewFocus.map((f, i) => (
                                 <span key={i} className="px-3 py-1.5 bg-white border border-indigo-200 rounded-lg text-xs font-bold text-indigo-800 shadow-sm">
                                   {f}
                                 </span>
                               ))}
                             </div>
                          </section>
                        )}

                        {/* Final Verdict Banner */}
                        <div className="bg-slate-900 text-white p-6 rounded-2xl flex items-center justify-between shadow-xl shadow-slate-900/10">
                          <div>
                            <div className="text-[10px] text-indigo-400 font-black uppercase tracking-widest mb-1">Proprietary Decision</div>
                            <div className="text-xl font-black flex items-center gap-3">
                              <ChevronRight className="w-5 h-5 text-indigo-500" />
                              {result.candidates[activeCandidate].recommendation}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-[10px] text-slate-400 font-bold uppercase mb-1">Action Priority</div>
                            <div className="text-lg font-black text-indigo-400">
                              {result.candidates[activeCandidate].recommendation === 'STRONG HIRE' ? 'Immediate' : 
                               result.candidates[activeCandidate].recommendation === 'REJECT' ? 'Close' : 'Queue'}
                            </div>
                          </div>
                        </div>
                        
                        <p className="text-[9px] text-slate-400 font-bold text-center uppercase tracking-widest italic pt-4">
                          "Proceeding without evidence is a recruitment failure."
                        </p>
                      </div>
                    </motion.div>
                  )}
                </div>
              </div>
            </div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function AnalysisTable({ title, skills, accent }: { title: string; skills: any[]; accent: string }) {
  if (!skills || skills.length === 0) return null;
  
  return (
    <div>
      <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4">{title}</h3>
      <div className={cn("overflow-hidden border border-slate-100 rounded-xl shadow-sm", accent)}>
        <table className="w-full text-left text-[11px] border-collapse bg-white">
          <thead>
            <tr className="bg-slate-50 text-slate-500 border-b border-slate-100">
              <th className="px-5 py-3 font-bold uppercase tracking-tighter w-1/4">Requirement</th>
              <th className="px-5 py-3 font-bold uppercase tracking-tighter w-16 text-center">Match</th>
              <th className="px-5 py-3 font-bold uppercase tracking-tighter">Evidence / Evidence Analysis</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {skills.map((s, i) => (
              <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-5 py-4 font-bold text-slate-800">{s.skill}</td>
                <td className="px-5 py-4 text-center">
                  <span className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-tighter",
                    s.match === 'YES' ? 'text-emerald-600 bg-emerald-50' :
                    s.match === 'PARTIAL' ? 'text-yellow-600 bg-yellow-50' : 'text-rose-600 bg-rose-50'
                  )}>
                    {s.match}
                  </span>
                </td>
                <td className="px-5 py-4 text-slate-500 italic leading-relaxed">
                  {s.match === 'NO' ? s.gap : s.evidence}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
