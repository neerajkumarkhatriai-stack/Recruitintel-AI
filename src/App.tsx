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
  ArrowRight,
  LogOut
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { recruitmentEngine } from './services/geminiService';
import { MultiCandidateAnalysis, CandidateEvaluation, Job, JDStruct } from './types';
import { cn } from './lib/utils';
import { auth, db, signIn, signOut } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  onSnapshot, 
  serverTimestamp, 
  doc, 
  getDocFromServer,
  setDoc,
  deleteDoc,
  orderBy,
  where
} from 'firebase/firestore';

import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import mammoth from 'mammoth';

// Use Vite's asset handling for the worker to ensure it works correctly in the preview environment
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const extractText = async (file: File): Promise<string> => {
  if (file.type === 'application/pdf') {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ 
        data: arrayBuffer,
        useSystemFonts: true,
        disableFontFace: true // Can help in some restricted environments
      });
      const pdf = await loadingTask.promise;
      let fullText = '';
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => 'str' in item ? item.str : '').join(' ');
        fullText += pageText + '\n';
      }
      return fullText;
    } catch (err) {
      console.error("Detailed PDF Extraction Error:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read PDF "${file.name}". Error: ${errorMessage}`);
    }
  } else if (
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || 
    file.name.endsWith('.docx')
  ) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  } else {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string || "");
      reader.readAsText(file);
    });
  }
};

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();

export default function App() {
  const [user, setUser] = React.useState<User | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [showCreateJob, setShowCreateJob] = useState(false);
  
  const [newJobTitle, setNewJobTitle] = useState('');
  const [newJobJd, setNewJobJd] = useState('');
  const [isCreatingJob, setIsCreatingJob] = useState(false);

  // States for Active Job Analysis
  const [resumes, setResumes] = useState<{ file: File; text: string }[]>([]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluations, setEvaluations] = useState<CandidateEvaluation[]>([]);
  const [activeCandidate, setActiveCandidate] = useState<number | null>(null);

  React.useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
  }, []);

  React.useEffect(() => {
    if (!user) {
      setJobs([]);
      return;
    }
    const q = query(collection(db, 'jobs'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      const jobList = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Job));
      setJobs(jobList);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'jobs');
    });
  }, [user]);

  React.useEffect(() => {
    if (!selectedJobId) {
      setEvaluations([]);
      return;
    }
    const q = query(collection(db, 'jobs', selectedJobId, 'evaluations'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      const evals = snapshot.docs.map(d => d.data().data as CandidateEvaluation);
      setEvaluations(evals);
      if (evals.length > 0 && activeCandidate === null) {
        setActiveCandidate(0);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `jobs/${selectedJobId}/evaluations`);
    });
  }, [selectedJobId]);

  const handleCreateJob = async () => {
    if (!newJobTitle || !newJobJd || !user) return;
    setIsCreatingJob(true);
    try {
      const structure = await recruitmentEngine.structureJD(newJobJd);
      const jobData: Partial<Job> = {
        title: newJobTitle,
        rawDescription: newJobJd,
        structure,
        createdAt: serverTimestamp(),
        createdBy: user.uid
      };
      const docRef = await addDoc(collection(db, 'jobs'), jobData);
      setSelectedJobId(docRef.id);
      setShowCreateJob(false);
      setNewJobTitle('');
      setNewJobJd('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'jobs');
    } finally {
      setIsCreatingJob(false);
    }
  };

  const currentJob = jobs.find(j => j.id === selectedJobId);

  const onDropResumes = async (acceptedFiles: File[]) => {
    try {
      const newResumes = await Promise.all(
        acceptedFiles.map(async (file) => ({
          file,
          text: await extractText(file),
        }))
      );
      setResumes((prev) => [...prev, ...newResumes]);
    } catch (error) {
      console.error("Upload Error:", error);
      alert(error instanceof Error ? error.message : "Failed to process one or more files.");
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDropResumes,
    accept: { 
      'text/plain': ['.txt'], 
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx']
    },
    multiple: true
  } as any);

  const handleEvaluate = async () => {
    if (!currentJob || resumes.length === 0 || !user) return;
    setIsEvaluating(true);
    try {
      const analysis = await recruitmentEngine.evaluateCandidates(
        currentJob.rawDescription,
        resumes.map((r) => r.text)
      );
      
      // Save evaluations to Firestore
      const batch = analysis.candidates.map(candidate => {
        return addDoc(collection(db, 'jobs', selectedJobId!, 'evaluations'), {
          candidateName: candidate.name,
          score: candidate.score,
          data: candidate,
          createdAt: serverTimestamp()
        });
      });
      await Promise.all(batch);
      
      setResumes([]); // Clear queue after saving
      setActiveCandidate(0);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `jobs/${selectedJobId}/evaluations`);
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

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-3xl p-12 shadow-2xl max-w-md w-full text-center"
        >
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center font-bold text-white text-2xl shadow-xl shadow-indigo-500/20 mx-auto mb-8">
            RE
          </div>
          <h1 className="text-3xl font-black text-slate-900 mb-2 tracking-tight">RecruitIntel AI</h1>
          <p className="text-slate-500 font-medium mb-10 leading-relaxed">
            Enterprise Recruitement Intelligence. <br/> Sign in to manage job profiles & analyze talent.
          </p>
          <button 
            onClick={signIn}
            className="w-full py-4 bg-slate-900 text-white rounded-xl font-bold flex items-center justify-center gap-3 hover:bg-slate-800 transition-all shadow-lg"
          >
            <div className="bg-white p-1 rounded-sm">
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-4 h-4" />
            </div>
            Sign in with Google
          </button>
          <div className="mt-8 pt-8 border-t border-slate-100 flex items-center justify-center gap-4 text-xs font-bold text-slate-400 uppercase tracking-widest">
            <span>Secure Access</span>
            <span className="w-1 h-1 bg-slate-200 rounded-full" />
            <span>AI Powered</span>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex overflow-hidden">
      {/* Sidebar: Job Profiles */}
      <div className="w-[320px] bg-slate-900 border-r border-slate-800 h-screen overflow-y-auto p-6 sticky top-0 flex flex-col shrink-0">
        <div className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center font-bold text-xs text-white">
              RE
            </div>
            <h1 className="font-bold text-sm text-white">RecruitIntel</h1>
          </div>
          <button onClick={signOut} className="text-slate-500 hover:text-white transition-colors" title="Sign Out">
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        <button 
          onClick={() => setShowCreateJob(true)}
          className="mb-8 w-full py-3 bg-indigo-600 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20"
        >
          <FileText className="w-4 h-4" />
          CREATE NEW JOB PROFILE
        </button>

        <div className="space-y-1">
          <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-4 px-2">Job Profiles Repository</h2>
          {jobs.map(j => (
            <button 
              key={j.id}
              onClick={() => {
                setSelectedJobId(j.id || null);
                setShowCreateJob(false);
              }}
              className={cn(
                "w-full text-left px-4 py-3 rounded-xl transition-all group",
                selectedJobId === j.id 
                  ? "bg-indigo-600/10 border border-indigo-500/30 text-indigo-400" 
                  : "text-slate-400 hover:bg-slate-800/50"
              )}
            >
              <div className="text-[13px] font-bold truncate group-hover:text-white transition-colors">{j.title}</div>
              <div className="text-[10px] opacity-60 font-mono mt-1">ID: {j.id?.slice(0, 8).toUpperCase()}</div>
            </button>
          ))}
        </div>

        <div className="mt-auto pt-6 border-t border-slate-800">
          <div className="flex items-center gap-3">
            <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border border-slate-700" />
            <div className="overflow-hidden">
              <div className="text-xs font-bold text-white truncate">{user.displayName}</div>
              <div className="text-[10px] text-slate-500 truncate">{user.email}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Dashboard Area */}
      <main className="flex-1 overflow-y-auto bg-slate-50 pt-8 px-12 pb-12 relative">
        <AnimatePresence mode="wait">
          {showCreateJob ? (
            <motion.div 
               key="create"
               initial={{ opacity: 0, x: 20 }}
               animate={{ opacity: 1, x: 0 }}
               exit={{ opacity: 0, x: -20 }}
               className="max-w-2xl mx-auto py-12"
            >
               <h2 className="text-3xl font-black mb-8 tracking-tight">Configure New Intelligence Profile</h2>
               <div className="space-y-6">
                 <div>
                   <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest block mb-2">Internal Role Name</label>
                   <input 
                      value={newJobTitle}
                      onChange={(e) => setNewJobTitle(e.target.value)}
                      placeholder="e.g. Senior Software Architect - Q4 Expansion"
                      className="w-full p-4 bg-white border border-slate-200 rounded-xl font-bold focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                   />
                 </div>
                 <div>
                   <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest block mb-2">Detailed Job Description</label>
                   <textarea 
                      value={newJobJd}
                      onChange={(e) => setNewJobJd(e.target.value)}
                      placeholder="Paste the full job description text here..."
                      className="w-full h-96 p-6 bg-white border border-slate-200 rounded-xl text-sm leading-relaxed focus:ring-2 focus:ring-indigo-500 outline-none transition-all resize-none"
                   />
                 </div>
                 <button 
                    onClick={handleCreateJob}
                    disabled={isCreatingJob || !newJobTitle || !newJobJd}
                    className="w-full py-5 bg-indigo-600 text-white rounded-xl font-black text-sm uppercase tracking-widest hover:bg-indigo-700 transition-all disabled:bg-slate-200 disabled:text-slate-400 shadow-xl shadow-indigo-600/20"
                 >
                   {isCreatingJob ? "Analyzing Engine Parameters..." : "Initialize Profile & Structuring"}
                 </button>
               </div>
            </motion.div>
          ) : !selectedJobId ? (
            <motion.div 
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto"
            >
              <div className="w-20 h-20 bg-white shadow-2xl shadow-slate-200 border border-slate-200 rounded-3xl flex items-center justify-center mb-8">
                <Target className="w-10 h-10 text-slate-200" />
              </div>
              <h2 className="text-2xl font-black mb-4 tracking-tight">No Active Profile</h2>
              <p className="text-slate-400 text-sm leading-relaxed font-medium">
                Select an existing job profile from the repository or initialize a new one to begin talent analysis.
              </p>
            </motion.div>
          ) : (
            <motion.div 
              key={selectedJobId}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="max-w-6xl mx-auto space-y-10"
            >
              {/* Active Profile Header */}
              {currentJob && (
                <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-1 block">Active Recruitment Context</span>
                      <h2 className="text-3xl font-black tracking-tight">{currentJob.structure?.roleTitle || currentJob.title}</h2>
                      <div className="flex items-center gap-2 mt-3 overflow-x-auto no-scrollbar">
                        {currentJob.structure?.toolsTechStack.slice(0, 8).map((t, i) => (
                          <span key={i} className="px-2 py-0.5 bg-slate-100 rounded text-[9px] font-black text-slate-500 uppercase tracking-tighter">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="text-right">
                       <div className="text-[10px] font-bold text-slate-400 uppercase">Profile ID</div>
                       <div className="text-sm font-mono text-slate-300">#{selectedJobId.slice(0, 8).toUpperCase()}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-12 gap-8 pt-8 border-t border-slate-100">
                    <div className="col-span-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
                      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Scope Context</h3>
                      <div className="space-y-1">
                        <p className="text-xs font-bold text-slate-700 capitalize">{currentJob.structure?.seniorityLevel} Level</p>
                        <p className="text-[11px] text-slate-500">{currentJob.structure?.experienceRange}</p>
                        <p className="text-[11px] text-slate-500">{currentJob.structure?.domainIndustry}</p>
                      </div>
                    </div>
                    
                    <div className="col-span-4 bg-indigo-50/30 p-4 rounded-xl border border-indigo-100/50">
                      <h3 className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                        <Users className="w-3 h-3" />
                        Analyze New Candidates
                      </h3>
                      <div {...getRootProps()} className="border border-indigo-200 border-dashed rounded-lg p-4 bg-white/50 text-center cursor-pointer hover:bg-white transition-all">
                        <input {...getInputProps()} />
                        <Upload className="w-4 h-4 mx-auto mb-2 text-indigo-400" />
                        <p className="text-[10px] font-bold text-indigo-600 uppercase">Queue Resumes ({resumes.length})</p>
                      </div>
                      {resumes.length > 0 && (
                        <button 
                           onClick={handleEvaluate}
                           disabled={isEvaluating}
                           className="w-full mt-3 py-2 bg-indigo-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest shadow-lg shadow-indigo-600/20"
                        >
                          {isEvaluating ? "Processing Stack..." : "Run Analysis"}
                        </button>
                      )}
                    </div>

                    <div className="col-span-5 bg-slate-50 p-4 rounded-xl border border-slate-200">
                       <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Core Success Metrics</h3>
                       <div className="grid grid-cols-2 gap-2">
                         {currentJob.structure?.screeningCriteria.slice(0, 4).map((c, i) => (
                           <div key={i} className="text-[9px] text-slate-500 font-bold flex items-start gap-2 bg-white p-2 rounded-lg shadow-sm border border-slate-100">
                             <CheckCircle2 className="w-2.5 h-2.5 text-indigo-500 shrink-0 mt-0.5" />
                             {c}
                           </div>
                         ))}
                       </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Dashboard Grid for Evaluations */}
              {evaluations.length > 0 ? (
                <div className="grid grid-cols-12 gap-8 items-start">
                  {/* Ranking Column */}
                  <div className="col-span-12 space-y-4">
                    <div className="flex items-center justify-between px-2">
                      <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Candidate Intelligence Pool</h3>
                      <span className="text-[10px] font-mono text-slate-300">{evaluations.length} Profiles</span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                      {evaluations.sort((a, b) => b.score - a.score).map((cand, idx) => {
                        const isSelected = activeCandidate === idx;
                        const scoreColor = cand.score >= 90 ? 'text-emerald-600 bg-emerald-50 border-emerald-100' : 
                                          cand.score >= 75 ? 'text-indigo-600 bg-indigo-50 border-indigo-100' :
                                          cand.score >= 60 ? 'text-yellow-600 bg-yellow-50 border-yellow-100' : 'text-rose-600 bg-rose-50 border-rose-100';
                        
                        return (
                          <div 
                            key={idx}
                            className={cn(
                              "bg-white border rounded-2xl p-6 shadow-sm flex flex-col gap-4 transition-all hover:shadow-md",
                              isSelected ? "ring-2 ring-indigo-600 border-transparent" : "border-slate-200"
                            )}
                          >
                            <div className="flex justify-between items-start">
                              <div className="flex-1">
                                <h4 className="font-black text-lg text-slate-900 leading-tight">{cand.name}</h4>
                                <p className="text-[11px] text-slate-400 font-bold uppercase tracking-tight mt-0.5">{cand.currentCompany || "N/A"}</p>
                              </div>
                              <div className={cn("px-3 py-1 rounded-lg border font-black text-sm", scoreColor)}>
                                {cand.score}
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-y-3 gap-x-2 pt-4 border-t border-slate-50">
                              <div className="flex items-center gap-2 overflow-hidden">
                                <div className="w-6 h-6 bg-slate-50 rounded flex items-center justify-center shrink-0">
                                  <Users className="w-3 h-3 text-slate-400" />
                                </div>
                                <span className="text-[10px] font-bold text-slate-600 truncate">{cand.phone || "No Phone"}</span>
                              </div>
                              <div className="flex items-center gap-2 overflow-hidden">
                                <div className="w-6 h-6 bg-slate-50 rounded flex items-center justify-center shrink-0">
                                  <FileText className="w-3 h-3 text-slate-400" />
                                </div>
                                <span className="text-[10px] font-bold text-slate-600 truncate uppercase tracking-tighter">{cand.email || "No Email"}</span>
                              </div>
                              <div className="flex items-center gap-2 overflow-hidden">
                                <div className="w-6 h-6 bg-slate-50 rounded flex items-center justify-center shrink-0">
                                  <Target className="w-3 h-3 text-slate-400" />
                                </div>
                                <span className="text-[10px] font-bold text-slate-600 truncate">{cand.location || "Unknown"}</span>
                              </div>
                              <div className="flex items-center gap-2 overflow-hidden">
                                <div className="w-6 h-6 bg-slate-50 rounded flex items-center justify-center shrink-0">
                                  <CheckCircle2 className="w-3 h-3 text-slate-400" />
                                </div>
                                <span className="text-[9px] font-black text-indigo-600 uppercase tracking-tighter">{cand.verdict}</span>
                              </div>
                            </div>

                            <button 
                              onClick={() => setActiveCandidate(idx)}
                              className={cn(
                                "mt-2 w-full py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ring-1",
                                isSelected ? "bg-indigo-600 text-white ring-indigo-600" : "bg-slate-50 text-slate-600 ring-slate-100 hover:bg-slate-100"
                              )}
                            >
                              {isSelected ? "REPORT ACTIVE" : "VIEW DETAILED SCORE"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Report Area */}
                  <div className="col-span-12 mt-12">
                    {activeCandidate !== null && evaluations[activeCandidate] && (
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
                              Intelligence Node: EVAL-{evaluations[activeCandidate].name.slice(0, 3).toUpperCase()}-{Math.random().toString(36).substring(7).toUpperCase()}
                            </p>
                          </div>
                          <div className="text-center bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                            <div className={cn(
                              "text-3xl font-black leading-none",
                              evaluations[activeCandidate].score >= 75 ? 'text-indigo-600' : 'text-slate-900'
                            )}>
                              {evaluations[activeCandidate].score}
                            </div>
                            <div className="text-[9px] font-bold text-slate-400 uppercase mt-1">Match Score</div>
                          </div>
                        </div>

                        <div className="p-8 space-y-10">
                          {/* Executive Summary */}
                          <section>
                            <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-4">Executive Summary</h3>
                            <p className="text-[14px] leading-relaxed text-slate-700 font-medium">
                              {evaluations[activeCandidate].summary}
                            </p>
                          </section>

                          {/* Analysis Tables */}
                          <AnalysisTable 
                            title="Requirement Compliance (Must-Have)" 
                            skills={evaluations[activeCandidate].mustHaveAnalysis} 
                            accent="border-slate-900"
                          />

                          {/* Stability Score Section */}
                          <section className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm border-l-4 border-l-blue-500">
                            <div className="flex items-center justify-between mb-4">
                              <div>
                                <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-1">Career Stability Index</h3>
                                <p className="text-xs text-slate-500 font-medium italic">Evaluates job longevity and risk of attrition</p>
                              </div>
                              <div className="flex flex-col items-center justify-center bg-blue-50 w-16 h-16 rounded-xl border border-blue-100">
                                <span className="text-2xl font-black text-blue-600">{evaluations[activeCandidate].stabilityScore}</span>
                                <span className="text-[8px] font-bold text-blue-400 uppercase">STABILITY</span>
                              </div>
                            </div>
                            <div className="p-4 bg-slate-50 rounded-lg text-xs leading-relaxed text-slate-600 font-medium">
                              {evaluations[activeCandidate].stabilityAnalysis}
                            </div>
                          </section>

                          {/* Flags Grid */}
                          <div className="grid grid-cols-2 gap-6">
                            <div className="bg-emerald-50/50 p-5 border border-emerald-100 rounded-xl">
                              <h4 className="text-[10px] font-black text-emerald-700 uppercase tracking-widest mb-3 flex items-center gap-2">
                                <CheckCircle2 className="w-3 h-3" />
                                Advantage Signals
                              </h4>
                              <ul className="text-[12px] text-emerald-900 font-medium space-y-2">
                                {evaluations[activeCandidate].strengths.map((s, i) => (
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
                                    evaluations[activeCandidate].riskAssessment.level === 'Low' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'
                                  )}>
                                    {evaluations[activeCandidate].riskAssessment.level} Risk
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-600 leading-tight font-medium">
                                  {evaluations[activeCandidate].riskAssessment.justification}
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* Interview Protocol Section */}
                          {evaluations[activeCandidate].recommendation !== 'REJECT' && evaluations[activeCandidate].interviewQuestions && (
                            <section className="bg-slate-50 border border-slate-200 rounded-2xl p-8 shadow-sm">
                              <div className="flex items-center gap-3 mb-6">
                                <Target className="w-5 h-5 text-indigo-600" />
                                <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Interview Protocol (100% Core Skill Coverage)</h3>
                              </div>
                              <div className="space-y-6">
                                {evaluations[activeCandidate].interviewQuestions.map((q, i) => (
                                  <div key={i} className="bg-white border border-slate-100 rounded-xl p-5 shadow-sm">
                                    <div className="flex items-center justify-between mb-3">
                                      <div className="flex items-center gap-2">
                                        <span className={cn(
                                          "px-2 py-0.5 rounded-[4px] text-[9px] font-black uppercase tracking-tighter",
                                          q.category === 'Technical' ? 'bg-indigo-600 text-white' : 'bg-slate-900 text-white'
                                        )}>
                                          {q.category}
                                        </span>
                                        <span className="text-[10px] font-bold text-slate-400 uppercase">Target: {q.targetSkill}</span>
                                      </div>
                                      <span className="text-[10px] font-mono text-slate-300">Q-{String(i + 1).padStart(2, '0')}</span>
                                    </div>
                                    <p className="text-sm font-bold text-slate-900 mb-4 leading-snug">
                                      {q.question}
                                    </p>
                                    <div className="bg-slate-50 p-4 rounded-lg border-l-4 border-slate-300">
                                      <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Ideal Response Pattern</h4>
                                      <p className="text-xs text-slate-600 leading-relaxed font-medium capitalize">
                                        {q.idealAnswer}
                                      </p>
                                    </div>
                                  </div>
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
                                {evaluations[activeCandidate].recommendation}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-[10px] text-slate-400 font-bold uppercase mb-1">Action Priority</div>
                              <div className="text-lg font-black text-indigo-400">
                                {evaluations[activeCandidate].recommendation === 'STRONG HIRE' ? 'Immediate' : 
                                 evaluations[activeCandidate].recommendation === 'REJECT' ? 'Close' : 'Queue'}
                              </div>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-white border border-slate-200 rounded-2xl p-20 text-center shadow-sm">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Users className="w-8 h-8 text-slate-200" />
                  </div>
                  <h3 className="text-xl font-black text-slate-900 mb-2">No Candidates Evaluated Yet</h3>
                  <p className="text-slate-500 text-sm max-w-sm mx-auto">
                    Queue candidate resumes on the left and run the intelligence engine to generate assessment reports.
                  </p>
                </div>
              )}
            </motion.div>
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
