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
  LogOut,
  FolderOpen,
  Plus,
  Briefcase,
  ExternalLink,
  Edit,
  MoreVertical,
  X,
  Copy,
  ArrowLeftRight,
  ChevronDown
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { recruitmentEngine } from './services/geminiService';
import { MultiCandidateAnalysis, CandidateEvaluation, Job, JDStruct, Project, HiringStatus } from './types';
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
  where,
  getDocs
} from 'firebase/firestore';

import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
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

const getStatusColor = (status: HiringStatus) => {
  switch (status) {
    case 'New': return 'text-blue-600 bg-blue-50 border-blue-100';
    case 'Screening': return 'text-amber-600 bg-amber-50 border-amber-100';
    case 'Interview': return 'text-indigo-600 bg-indigo-50 border-indigo-100';
    case 'Offered': return 'text-emerald-600 bg-emerald-50 border-emerald-100';
    case 'Hired': return 'text-emerald-700 bg-emerald-100 border-emerald-200';
    case 'Rejected': return 'text-rose-600 bg-rose-50 border-rose-100';
    default: return 'text-slate-600 bg-slate-50 border-slate-100';
  }
};

const getScoreColor = (score: number) => {
  if (score >= 90) return 'text-emerald-500 bg-emerald-50 border-emerald-100';
  if (score >= 75) return 'text-indigo-600 bg-indigo-50 border-indigo-100';
  if (score >= 60) return 'text-amber-600 bg-amber-50 border-amber-100';
  return 'text-rose-600 bg-rose-50 border-rose-100';
};

export default function App() {
  const [user, setUser] = React.useState<User | null>(null);
  
  // Data State
  const [projects, setProjects] = useState<Project[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [evaluations, setEvaluations] = useState<CandidateEvaluation[]>([]);
  const [allEvaluations, setAllEvaluations] = useState<CandidateEvaluation[]>([]);
  
  React.useEffect(() => {
     if (!user) return;
     // Fetch all evaluations across all projects for this user to detect duplicates globally
      const fetchAll = async () => {
        try {
          const projectsSnap = await getDocs(query(collection(db, 'projects'), where('createdBy', '==', user.uid)));
          const all: any[] = [];
          for (const pDoc of projectsSnap.docs) {
            const jobsSnap = await getDocs(collection(db, 'projects', pDoc.id, 'jobs'));
            for (const jDoc of jobsSnap.docs) {
              const evalsSnap = await getDocs(collection(db, 'projects', pDoc.id, 'jobs', jDoc.id, 'evaluations'));
              evalsSnap.docs.forEach(d => all.push({ ...d.data(), id: d.id, jobId: jDoc.id, projectId: pDoc.id } as any));
            }
          }
          setAllEvaluations(all);
        } catch (e) { console.error("Global duplicate fetch failed", e); }
      };
     fetchAll();
  }, [user, evaluations]); // Refresh when local evaluations change
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
  
  // UI State
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [showEditJob, setShowEditJob] = useState(false);
  const [showCandidateDetails, setShowCandidateDetails] = useState(false);

  // Duplicate Check logic - naive but works for this scope
  const checkDuplicate = (email: string, currentId: string) => {
     // Check if email exists in any other evaluation we've seen
     return allEvaluations.find(e => e.email === email && e.id !== currentId);
  };
  const [newProjectName, setNewProjectName] = useState('');
  const [newJobTitle, setNewJobTitle] = useState('');
  const [newJobReqId, setNewJobReqId] = useState('');
  const [newJobJd, setNewJobJd] = useState('');
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [resumes, setResumes] = useState<{ file: File; text: string }[]>([]);

  // Auth Listener
  React.useEffect(() => {
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

  // Fetch Projects
  React.useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'projects'), where('createdBy', '==', user.uid), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      setProjects(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Project)));
    });
  }, [user]);

  // Fetch Jobs for the selected Project
  React.useEffect(() => {
    if (!selectedProjectId) {
      setJobs([]);
      return;
    }
    const q = query(collection(db, 'projects', selectedProjectId, 'jobs'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      setJobs(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Job)));
    });
  }, [selectedProjectId]);

  // Fetch Evaluations for the selected Job
  React.useEffect(() => {
    if (!selectedJobId || !selectedProjectId) {
      setEvaluations([]);
      return;
    }
    const q = query(collection(db, 'projects', selectedProjectId, 'jobs', selectedJobId, 'evaluations'), orderBy('createdAt', 'desc'));
    return onSnapshot(q, (snapshot) => {
      setEvaluations(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as CandidateEvaluation)));
    });
  }, [selectedJobId, selectedProjectId]);

  const handleCreateProject = async () => {
    if (!newProjectName || !user) return;
    setIsProcessing(true);
    try {
      await addDoc(collection(db, 'projects'), {
        name: newProjectName,
        createdAt: serverTimestamp(),
        createdBy: user.uid
      });
      setShowCreateProject(false);
      setNewProjectName('');
    } catch (e) { handleFirestoreError(e, OperationType.CREATE, 'projects'); }
    finally { setIsProcessing(false); }
  };

  const handleCreateJob = async () => {
    if (!newJobTitle || !newJobJd || !selectedProjectId || !user) return;
    setIsProcessing(true);
    try {
      const structure = await recruitmentEngine.structureJD(newJobJd);
      const reqId = newJobReqId.trim() || `REQ-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      
      await addDoc(collection(db, 'projects', selectedProjectId, 'jobs'), {
        title: newJobTitle,
        reqId: reqId,
        projectId: selectedProjectId,
        rawDescription: newJobJd,
        structure,
        createdAt: serverTimestamp(),
        createdBy: user.uid
      });
      setShowCreateJob(false);
      setNewJobTitle('');
      setNewJobReqId('');
      setNewJobJd('');
    } catch (e) { handleFirestoreError(e, OperationType.CREATE, 'jobs'); }
    finally { setIsProcessing(false); }
  };

  const handleUpdateJob = async () => {
    if (!selectedJobId || !selectedProjectId || !newJobTitle || !newJobJd) return;
    setIsProcessing(true);
    try {
      const structure = await recruitmentEngine.structureJD(newJobJd);
      const reqId = newJobReqId.trim() || `REQ-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      
      await setDoc(doc(db, 'projects', selectedProjectId, 'jobs', selectedJobId), {
        title: newJobTitle,
        reqId: reqId,
        rawDescription: newJobJd,
        structure,
        updatedAt: serverTimestamp()
      }, { merge: true });
      setShowEditJob(false);
      setNewJobTitle('');
      setNewJobReqId('');
      setNewJobJd('');
    } catch (e) { handleFirestoreError(e, OperationType.UPDATE, 'jobs'); }
    finally { setIsProcessing(false); }
  };

  const currentJob = jobs.find(j => j.id === selectedJobId);
  const currentProject = projects.find(p => p.id === selectedProjectId);
  const activeCandidate = evaluations.find(e => e.id === activeCandidateId);

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
    if (!currentJob || resumes.length === 0 || !user || !selectedProjectId || !selectedJobId) return;
    setIsProcessing(true);
    try {
      const analysis = await recruitmentEngine.evaluateCandidates(
        currentJob.rawDescription,
        resumes.map((r) => r.text)
      );
      
      for (const candidate of analysis.candidates) {
        // Simple check for duplicate in the current job (prevent same analysis twice)
        const isDuplicateLocal = evaluations.some(e => e.email === candidate.email);
        if (isDuplicateLocal) continue;

        const evalData: Partial<CandidateEvaluation> = {
          ...candidate,
          status: 'New',
          createdAt: serverTimestamp() as any
        };

        await addDoc(collection(db, 'projects', selectedProjectId, 'jobs', selectedJobId, 'evaluations'), evalData);
      }
      
      setResumes([]); 
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `projects/${selectedProjectId}/jobs/${selectedJobId}/evaluations`);
    } finally {
      setIsProcessing(false);
    }
  };

  const updateCandidateStatus = async (evalId: string, newStatus: HiringStatus) => {
    if (!selectedProjectId || !selectedJobId) return;
    try {
      await setDoc(doc(db, 'projects', selectedProjectId, 'jobs', selectedJobId, 'evaluations', evalId), {
        status: newStatus,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (e) { handleFirestoreError(e, OperationType.UPDATE, 'evaluations'); }
  };

  const AnalysisTable = ({ title, skills, accent }: { title: string; skills: any[]; accent: string }) => (
    <div className={cn("p-6 rounded-3xl bg-white", accent)}>
      <h3 className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] mb-6">{title}</h3>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-slate-400 font-bold uppercase tracking-widest">
            <th className="pb-4 text-left">Requirement</th>
            <th className="pb-4 text-center">Status</th>
            <th className="pb-4 text-right">Confidence</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {skills.map((s, i) => (
            <tr key={i} className="group">
              <td className="py-4 text-slate-700 font-bold max-w-[200px] truncate">{s.skill}</td>
              <td className="py-4">
                <div className="flex justify-center">
                  <div className={cn("px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter", 
                    s.status === 'Match' ? 'bg-emerald-500/10 text-emerald-600' : 
                    s.status === 'Partial' ? 'bg-amber-500/10 text-amber-600' : 'bg-rose-500/10 text-rose-600')}>
                    {s.status}
                  </div>
                </div>
              </td>
              <td className="py-4 text-right font-black text-slate-400 group-hover:text-indigo-600 transition-colors">{s.confidence}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const [showMoveCandidate, setShowMoveCandidate] = useState<string | null>(null);

  const moveCandidate = async (targetJobId: string, candId: string, isLinking = false) => {
    if (!selectedProjectId || !selectedJobId) return;
    try {
      const cand = evaluations.find(e => e.id === candId);
      if (!cand) return;

      const newEval = { ...cand, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), status: 'New' };
      const { id, ...cleanEval } = newEval;
      
      await addDoc(collection(db, 'projects', selectedProjectId, 'jobs', targetJobId, 'evaluations'), cleanEval);
      
      if (!isLinking) {
        await deleteDoc(doc(db, 'projects', selectedProjectId, 'jobs', selectedJobId, 'evaluations', candId));
      }
      
      setShowMoveCandidate(null);
    } catch (e) { handleFirestoreError(e, OperationType.WRITE, 'evaluations'); }
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
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex overflow-hidden">
      {/* Sidebar: Projects & JDs */}
      <div className="w-[300px] bg-slate-900 border-r border-slate-800 h-screen overflow-y-auto p-6 sticky top-0 flex flex-col shrink-0 no-scrollbar">
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center font-bold text-xs text-white">RE</div>
            <h1 className="font-bold text-sm text-white">RecruitIntel</h1>
          </div>
          <button onClick={signOut} className="text-slate-500 hover:text-white transition-colors" title="Sign Out">
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-6">
          <div className="flex items-center justify-between px-2">
            <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Registry</h2>
            <button onClick={() => setShowCreateProject(true)} className="text-indigo-400 hover:text-white transition-colors">
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-1">
            {projects.map(p => (
              <div key={p.id}>
                <button 
                  onClick={() => {
                    setSelectedProjectId(p.id === selectedProjectId ? null : p.id || null);
                    setSelectedJobId(null);
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-lg transition-all flex items-center justify-between group",
                    selectedProjectId === p.id ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800/50"
                  )}
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <FolderOpen className={cn("w-3.5 h-3.5 shrink-0", selectedProjectId === p.id ? "text-indigo-400" : "text-slate-600")} />
                    <span className="text-[13px] font-bold truncate">{p.name}</span>
                  </div>
                  {selectedProjectId === p.id ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-600 opacity-0 group-hover:opacity-100" />}
                </button>
                {selectedProjectId === p.id && (
                  <div className="pl-4 mt-1 space-y-1 border-l border-slate-800 ml-4 py-1">
                    {jobs.map(j => (
                      <button 
                        key={j.id}
                        onClick={() => setSelectedJobId(j.id || null)}
                        className={cn(
                          "w-full text-left px-3 py-1.5 rounded-md transition-all text-xs flex items-center justify-between group/jd",
                          selectedJobId === j.id ? "bg-indigo-600/10 text-indigo-400 font-bold" : "text-slate-500 hover:text-slate-300"
                        )}
                      >
                        <div className="flex flex-col min-w-0">
                          <span className="truncate">{j.title}</span>
                          {j.reqId && <span className="text-[9px] opacity-60 font-black tracking-widest">{j.reqId}</span>}
                        </div>
                        {selectedJobId === j.id && <div className="w-1 h-1 bg-indigo-500 rounded-full" />}
                      </button>
                    ))}
                    <button 
                      onClick={() => setShowCreateJob(true)}
                      className="w-full text-left px-3 py-1.5 text-slate-600 hover:text-indigo-400 transition-colors text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5"
                    >
                      <Plus className="w-3 h-3" /> Add JD
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-auto pt-6 border-t border-slate-800 flex items-center gap-3">
          <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full" />
          <div className="overflow-hidden">
            <div className="text-xs font-bold text-white truncate">{user.displayName}</div>
            <div className="text-[10px] text-slate-500 truncate">{user.email}</div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto bg-slate-100 p-10 relative no-scrollbar">
        {!selectedJobId ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto">
            <div className="mb-6 p-6 bg-white rounded-3xl shadow-sm border border-slate-200">
              <Plus className="w-8 h-8 text-slate-200" />
            </div>
            <h2 className="text-xl font-black mb-2 uppercase tracking-tight">Select a Job Profile</h2>
            <p className="text-sm text-slate-500 font-medium leading-relaxed">
              Launch candidates analysis by choosing a recruitment profile from your registry.
            </p>
          </div>
        ) : (
          <div className="max-w-6xl mx-auto space-y-8">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-black tracking-tight flex items-center gap-3 capitalize">
                  {currentJob?.title}
                  {currentJob?.reqId && (
                    <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-black tracking-widest uppercase">{currentJob.reqId}</span>
                  )}
                  <button onClick={() => {
                    setNewJobTitle(currentJob?.title || '');
                    setNewJobReqId(currentJob?.reqId || '');
                    setNewJobJd(currentJob?.rawDescription || '');
                    setShowEditJob(true);
                  }} className="p-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-sm">
                    <Edit className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                </h2>
                <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500 font-medium">
                  <FolderOpen className="w-3.5 h-3.5" />
                  {currentProject?.name}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div {...getRootProps()} className="px-4 py-2 bg-white border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-all flex items-center gap-2">
                  <input {...getInputProps()} />
                  <Upload className="w-4 h-4 text-indigo-500" />
                  <span className="text-xs font-black text-slate-600 uppercase tracking-tight">Queue Resumes ({resumes.length})</span>
                </div>
                {resumes.length > 0 && (
                  <button 
                    onClick={handleEvaluate} 
                    disabled={isProcessing}
                    className="px-6 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 transition-all"
                  >
                    {isProcessing ? "PROCESSING..." : "RUN ANALYSIS"}
                  </button>
                )}
              </div>
            </div>

            {/* Candidate List (Table Format) */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-slate-50 flex items-center justify-between">
                <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <Users className="w-4 h-4 text-indigo-500" /> Candidate Intelligence Pool
                </h3>
                <span className="px-3 py-1 bg-slate-50 rounded-full text-[10px] font-black text-slate-400 uppercase">{evaluations.length} Results</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/50 text-[10px] uppercase font-black tracking-widest text-slate-400 border-b border-slate-50">
                      <th className="px-8 py-4">Candidate & Status</th>
                      <th className="px-8 py-4">Location</th>
                      <th className="px-8 py-4">Current Company</th>
                      <th className="px-8 py-4 text-center">Match Score</th>
                      <th className="px-8 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {evaluations.map((cand) => (
                      <tr key={cand.id} className="hover:bg-slate-50/50 transition-colors group">
                        <td className="px-8 py-5">
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-2">
                               <span className="font-black text-slate-900 leading-tight">{cand.name}</span>
                               {(() => {
                                  const dupe = checkDuplicate(cand.email, cand.id!);
                                  if (!dupe) return null;
                                  return (
                                    <button 
                                      onClick={() => {
                                        // To see report of duplicate, we might need to change selection
                                        // or just use the local report if the data is identical
                                        setActiveCandidateId(dupe.id || null);
                                        setShowCandidateDetails(true);
                                      }}
                                      className="px-1.5 py-0.5 bg-rose-50 text-rose-600 rounded border border-rose-100 flex items-center gap-1 hover:bg-rose-100 transition-colors"
                                    >
                                       <AlertCircle className="w-2 h-2" />
                                       <span className="text-[7px] font-black uppercase tracking-tighter">Duplicate Detected (View Report)</span>
                                    </button>
                                  );
                               })()}
                            </div>
                            <div className="flex items-center gap-2">
                              <select 
                                value={cand.status}
                                onChange={(e) => updateCandidateStatus(cand.id!, e.target.value as HiringStatus)}
                                className={cn("text-[8px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded border border-transparent outline-none cursor-pointer", getStatusColor(cand.status))}
                              >
                                {['New', 'Screening', 'Interview', 'Offered', 'Hired', 'Rejected'].map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                              <span className="text-[9px] text-slate-400 font-medium truncate max-w-[150px]">{cand.email}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-8 py-5 text-xs text-slate-500 font-medium">{cand.location || 'N/A'}</td>
                        <td className="px-8 py-5 text-xs text-slate-500 font-medium">{cand.currentCompany || 'N/A'}</td>
                        <td className="px-8 py-5">
                          <div className="flex justify-center">
                            <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm", getScoreColor(cand.score))}>
                              {cand.score}
                            </div>
                          </div>
                        </td>
                        <td className="px-8 py-5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button 
                              onClick={() => setShowMoveCandidate(cand.id || null)}
                              className="p-2 bg-white border border-slate-200 rounded-lg text-slate-400 hover:text-indigo-600 transition-all shadow-sm"
                              title="Move/Link Candidate"
                            >
                              <ArrowLeftRight className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => { setActiveCandidateId(cand.id || null); setShowCandidateDetails(true); }}
                              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-[9px] font-black uppercase tracking-widest shadow-md hover:bg-indigo-700 transition-all"
                            >
                              Report Active
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Modals */}
      <AnimatePresence>
        {/* Create Project Modal */}
        {showCreateProject && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl relative">
              <button onClick={() => setShowCreateProject(false)} className="absolute top-6 right-6 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
              <h2 className="text-xl font-black mb-6 uppercase tracking-tight">New Project</h2>
              <div className="space-y-4">
                <input 
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="e.g. Engineering Expansion"
                  className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
                />
                <button onClick={handleCreateProject} disabled={isProcessing || !newProjectName} className="w-full py-4 bg-indigo-600 text-white rounded-xl font-black uppercase tracking-widest text-xs hover:bg-indigo-700 transition-all disabled:bg-slate-100 disabled:text-slate-400">
                  {isProcessing ? 'CREATING...' : 'INITIALIZE PROJECT'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {/* Create/Edit Job Modal */}
        {(showCreateJob || showEditJob) && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm">
            <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="bg-white rounded-3xl p-8 max-w-2xl w-full shadow-2xl relative max-h-[90vh] overflow-y-auto no-scrollbar">
              <button onClick={() => { setShowCreateJob(false); setShowEditJob(false); }} className="absolute top-6 right-6 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
              <h2 className="text-2xl font-black mb-6 uppercase tracking-tight">{showEditJob ? 'Edit' : 'New'} Recruitment Profile</h2>
              <div className="space-y-6">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2 block">Position Title</label>
                  <input 
                    value={newJobTitle}
                    onChange={(e) => setNewJobTitle(e.target.value)}
                    placeholder="e.g. Senior Backend Engineer"
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold italic focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2 block">Req ID (Optional)</label>
                  <input 
                    value={newJobReqId}
                    onChange={(e) => setNewJobReqId(e.target.value)}
                    placeholder="e.g. REQ-2024-001 (Leave blank to auto-generate)"
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-bold italic focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2 block">Full Job Description</label>
                  <textarea 
                    value={newJobJd}
                    onChange={(e) => setNewJobJd(e.target.value)}
                    placeholder="Paste the raw description..."
                    className="w-full h-64 p-6 bg-slate-50 border border-slate-200 rounded-xl text-sm leading-relaxed focus:ring-2 focus:ring-indigo-500 outline-none italic resize-none"
                  />
                </div>
                <button onClick={showEditJob ? handleUpdateJob : handleCreateJob} disabled={isProcessing || !newJobTitle || !newJobJd} className="w-full py-5 bg-slate-900 text-white rounded-xl font-black uppercase tracking-widest text-xs hover:bg-slate-800 transition-all disabled:bg-slate-100 disabled:text-slate-400 shadow-xl">
                  {isProcessing ? 'PROCESSING ANALYSIS ENGINE...' : 'DEPLOY PROFILE'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {/* Candidate Detail Modal */}
        {showCandidateDetails && activeCandidate && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-md">
            <motion.div initial={{ y: 50, scale: 0.95 }} animate={{ y: 0, scale: 1 }} exit={{ y: 50, scale: 0.95 }} className="bg-white rounded-[2.5rem] w-full max-w-5xl max-h-[90vh] shadow-[0_50px_100px_-20px_rgba(0,0,0,0.3)] overflow-hidden flex flex-col">
              <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-4">
                  <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-black shadow-inner border border-white/50", getScoreColor(activeCandidate.score))}>
                    {activeCandidate.score}
                  </div>
                  <div>
                    <h2 className="text-3xl font-black tracking-tighter text-slate-900 leading-none">{activeCandidate.name}</h2>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-2">{activeCandidate.currentCompany || 'Independent'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                   <button className="p-3 bg-white border border-slate-200 rounded-2xl hover:bg-slate-50 text-slate-400 hover:text-slate-900 transition-all shadow-sm"><MoreVertical className="w-5 h-5" /></button>
                   <button onClick={() => setShowCandidateDetails(false)} className="p-3 bg-slate-900 text-white rounded-2xl hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/20"><X className="w-5 h-5" /></button>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto p-12 no-scrollbar">
                <div className="space-y-12">
                  {/* Summary & Tags */}
                  <section>
                    <h3 className="text-[10px] font-black text-slate-300 uppercase tracking-[0.3em] mb-6">Intelligence Briefing</h3>
                    <div className="flex flex-wrap gap-2 mb-6">
                      <span className={cn("px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-tight", getStatusColor(activeCandidate.status))}>{activeCandidate.status}</span>
                      <span className="px-4 py-1.5 bg-slate-100 rounded-full text-[10px] font-black text-slate-500 uppercase tracking-tight ring-1 ring-slate-200/50">{activeCandidate.verdict}</span>
                    </div>
                    <p className="text-lg leading-relaxed text-slate-700 italic font-medium serif">
                      "{activeCandidate.summary}"
                    </p>
                  </section>

                  {/* Analysis Grid */}
                  <div className="grid grid-cols-12 gap-10">
                    <div className="col-span-8 space-y-12">
                      <AnalysisTable title="Core Requirement Analysis" skills={activeCandidate.mustHaveAnalysis} accent="ring-1 ring-slate-100" />
                      <AnalysisTable title="Secondary Asset Mapping" skills={activeCandidate.goodToHaveAnalysis} accent="ring-1 ring-slate-100" />
                    </div>
                    <div className="col-span-4 space-y-8">
                       <section className="p-6 bg-slate-900 rounded-3xl text-white shadow-2xl relative overflow-hidden group">
                          <Target className="absolute -right-4 -bottom-4 w-24 h-24 text-white/5 opacity-10 group-hover:scale-110 transition-transform" />
                          <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-4">Integrity Evaluation</h4>
                          <div className="flex items-center gap-2 mb-4">
                            <span className={cn("px-2 py-0.5 rounded text-[9px] font-black uppercase", activeCandidate.riskAssessment.level === 'Low' ? 'bg-emerald-500' : 'bg-rose-500')}>
                              {activeCandidate.riskAssessment.level} Risk
                            </span>
                          </div>
                          <p className="text-[11px] leading-relaxed text-slate-300 font-medium italic">
                            {activeCandidate.riskAssessment.justification}
                          </p>
                       </section>

                       <section className="p-6 bg-white border border-slate-100 rounded-3xl shadow-sm border-l-4 border-l-indigo-500">
                          <div className="flex items-center justify-between mb-4">
                             <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Stability Index</h4>
                             <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center font-black text-indigo-600 text-sm">{activeCandidate.stabilityScore}</div>
                          </div>
                          <p className="text-[11px] leading-relaxed text-slate-600 font-medium">
                            {activeCandidate.stabilityAnalysis}
                          </p>
                       </section>
                    </div>
                  </div>

                  {/* Interview Protocol */}
                  {activeCandidate.interviewQuestions && activeCandidate.interviewQuestions.length > 0 && (
                    <section className="pt-12 border-t border-slate-50">
                      <h3 className="text-[10px] font-black text-slate-300 uppercase tracking-[0.3em] mb-8">Strategic Interview Protocol</h3>
                      <div className="grid grid-cols-2 gap-6">
                        {activeCandidate.interviewQuestions.map((q, i) => (
                          <div key={i} className="p-6 bg-slate-50/50 border border-slate-100 rounded-2xl hover:bg-white hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-default">
                             <div className="flex items-center justify-between mb-4">
                                <span className={cn("px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest", q.category === 'Technical' ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-600')}>
                                  {q.category}
                                </span>
                                <span className="text-[9px] font-bold text-slate-300">#{String(i + 1).padStart(2, '0')}</span>
                             </div>
                             <p className="text-[13px] font-bold text-slate-800 mb-4 leading-snug">{q.question}</p>
                             <div className="pt-4 border-t border-slate-200/50 italic text-[11px] text-slate-400 font-medium">
                               <span className="font-black text-slate-600 not-italic uppercase tracking-widest text-[8px] mr-2">Target:</span>
                               {q.targetSkill}
                             </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
        {/* Move/Link Candidate Modal */}
        {showMoveCandidate && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl relative">
              <button onClick={() => setShowMoveCandidate(null)} className="absolute top-6 right-6 text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
              <h2 className="text-xl font-black mb-6 uppercase tracking-tight">Relocate Candidate</h2>
              <p className="text-xs text-slate-500 font-medium mb-6">Select a target JD to move or cross-link this candidate.</p>
              
              <div className="space-y-2 mb-8 max-h-[300px] overflow-y-auto no-scrollbar">
                {jobs.filter(j => j.id !== selectedJobId).map(j => (
                  <div key={j.id} className="p-3 border border-slate-100 rounded-xl flex items-center justify-between hover:bg-slate-50 transition-colors">
                    <span className="text-[13px] font-bold text-slate-700">{j.title}</span>
                    <div className="flex gap-2">
                       <button onClick={() => moveCandidate(j.id!, showMoveCandidate, false)} className="px-3 py-1 bg-indigo-600 text-white rounded text-[9px] font-black uppercase tracking-widest">Move</button>
                       <button onClick={() => moveCandidate(j.id!, showMoveCandidate, true)} className="px-3 py-1 bg-slate-100 text-slate-600 rounded text-[9px] font-black uppercase tracking-widest">Link</button>
                    </div>
                  </div>
                ))}
                {jobs.filter(j => j.id !== selectedJobId).length === 0 && (
                  <p className="text-[10px] text-slate-400 italic text-center py-4">No other JDs available in this project.</p>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
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
