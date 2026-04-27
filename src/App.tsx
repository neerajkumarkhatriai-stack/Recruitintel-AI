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
  ChevronDown,
  LayoutDashboard,
  Settings2,
  Archive,
  Bell,
  Check,
  FolderLock
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { recruitmentEngine } from './services/geminiService';
import { MultiCandidateAnalysis, CandidateEvaluation, Job, JDStruct, Project, HiringStatus, UserProfile, Organization, Team, UserRole, AuditLog } from './types';
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
  updateDoc,
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
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [impersonatedUser, setImpersonatedUser] = useState<UserProfile | null>(null);
  
  // Data State
  const [projects, setProjects] = useState<Project[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [evaluations, setEvaluations] = useState<CandidateEvaluation[]>([]);
  const [allEvaluations, setAllEvaluations] = useState<CandidateEvaluation[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);

  const activeUserId = impersonatedUser?.uid || user?.uid;
  const activeOrgId = impersonatedUser?.orgId || userProfile?.orgId;
  const isSuperAdmin = userProfile?.isSuperAdmin || user?.email === 'neerajkumarkhatri.ai@gmail.com';
  
  // Handlers for Impersonation
  const startImpersonation = async (targetUser: UserProfile) => {
    if (!isSuperAdmin || !user) return;
    setImpersonatedUser(targetUser);
    setActiveTab('projects');
    // Audit Log
    try {
      await addDoc(collection(db, 'auditLogs'), {
        userId: user.uid,
        userEmail: user.email,
        action: 'IMPERSONATE_START',
        targetId: targetUser.uid,
        metadata: { targetEmail: targetUser.email },
        createdAt: serverTimestamp()
      });
    } catch (e) { console.error("Audit fail", e); }
  };

  const stopImpersonation = () => {
    setImpersonatedUser(null);
  };

  // Profile Engine
  React.useEffect(() => {
    if (!user) {
      setUserProfile(null);
      setImpersonatedUser(null);
      return;
    }
    
    // Check if profile exists
    const unsub = onSnapshot(doc(db, 'users', user.uid), async (snap) => {
      if (snap.exists()) {
        const profile = snap.data() as UserProfile;
        setUserProfile({ ...profile, uid: snap.id });
      } else {
        // Auto-provision
        const isSuperAdminEmail = user.email === 'neerajkumarkhatri.ai@gmail.com';
        const domain = user.email?.split('@')[1] || 'generic';
        const isGeneric = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com'].includes(domain);
        
        let targetOrgId = 'default-org';
        let targetRole: UserRole = 'ORG_ADMIN';

        if (isSuperAdminEmail) {
          targetOrgId = 'global'; // Super admins are global
          targetRole = 'SUPER_ADMIN';
        } else if (!isGeneric) {
          // Check for existing org or create
          const orgData = {
            name: domain.split('.')[0].toUpperCase(),
            subdomain: domain,
            status: 'active' as const,
            createdAt: serverTimestamp(),
            createdBy: user.uid
          };
          const orgRef = await addDoc(collection(db, 'organizations'), orgData);
          targetOrgId = orgRef.id;
        }

        const newProfile: UserProfile = {
          uid: user.uid,
          email: user.email || '',
          displayName: user.displayName || 'User',
          orgId: targetOrgId,
          role: targetRole,
          teamIds: [],
          isSuperAdmin: isSuperAdminEmail,
          createdAt: serverTimestamp()
        };
        await setDoc(doc(db, 'users', user.uid), newProfile);
      }
    });

    return () => unsub();
  }, [user]);

  // Global Registry for Super Admin
  React.useEffect(() => {
    if (!isSuperAdmin) return;
    const qOrgs = query(collection(db, 'organizations'), orderBy('createdAt', 'desc'));
    const unsubOrgs = onSnapshot(qOrgs, (snap) => {
      setOrganizations(snap.docs.map(d => ({ id: d.id, ...d.data() } as Organization)));
    });
    const qUsers = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    const unsubUsers = onSnapshot(qUsers, (snap) => {
      setAllUsers(snap.docs.map(d => ({ ...d.data(), uid: d.id } as UserProfile)));
    });
    return () => {
      unsubOrgs();
      unsubUsers();
    };
  }, [isSuperAdmin]);

  React.useEffect(() => {
     if (!activeUserId) return;
     // Fetch evaluations based on active context
      const fetchAll = async () => {
        try {
          let projectsQuery;
          if (isSuperAdmin && !impersonatedUser) {
            projectsQuery = collection(db, 'projects');
          } else if (activeOrgId) {
            projectsQuery = query(collection(db, 'projects'), where('orgId', '==', activeOrgId));
          } else {
            projectsQuery = query(collection(db, 'projects'), where('createdBy', '==', activeUserId));
          }

          const projectsSnap = await getDocs(projectsQuery);
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
  }, [activeUserId, activeOrgId, evaluations, isSuperAdmin, impersonatedUser]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
  
  // UI State
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [showEditJob, setShowEditJob] = useState(false);
  const [showCandidateDetails, setShowCandidateDetails] = useState(false);
  const [activeTab, setActiveTab] = useState<'projects' | 'manage' | 'closed'>('projects');
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<{id: string, text: string, time: string, read: boolean}[]>([
    { id: '1', text: '5 new resumes uploaded for AI/ML Engineer', time: '2m ago', read: false },
    { id: '2', text: 'Duplicate candidate detected in Penn Mutual project', time: '1h ago', read: false }
  ]);

  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgDomain, setNewOrgDomain] = useState('');
  const [newOrgSubdomain, setNewOrgSubdomain] = useState('');

  const handleCreateOrg = async () => {
    if (!isSuperAdmin || !newOrgName || !newOrgDomain || !user) return;
    setIsProcessing(true);
    try {
      const orgRef = await addDoc(collection(db, 'organizations'), {
        name: newOrgName,
        domain: newOrgDomain.toLowerCase(),
        subdomain: newOrgSubdomain || newOrgName.toLowerCase().replace(/\s+/g, '-'),
        status: 'active' as const,
        createdAt: serverTimestamp(),
        createdBy: user.uid
      });

      await addDoc(collection(db, 'auditLogs'), {
        userId: user.uid,
        userEmail: user.email,
        action: 'ORG_CREATE',
        targetId: orgRef.id,
        metadata: { name: newOrgName, domain: newOrgDomain },
        createdAt: serverTimestamp()
      });

      setShowCreateOrg(false);
      setNewOrgName('');
      setNewOrgDomain('');
      setNewOrgSubdomain('');
    } catch (e) { handleFirestoreError(e, OperationType.WRITE, 'organizations'); }
    finally { setIsProcessing(false); }
  };

  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserOrgId, setNewUserOrgId] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('ORG_ADMIN');

  const handleCreateUser = async () => {
    if (!isSuperAdmin || !newUserName || !newUserEmail || !newUserOrgId || !user) return;
    
    // Domain Validation
    const org = organizations.find(o => o.id === newUserOrgId);
    if (org && newUserRole === 'ORG_ADMIN') {
      const emailDomain = newUserEmail.split('@')[1];
      if (emailDomain?.toLowerCase() !== org.domain?.toLowerCase()) {
        alert(`Domain mismatch: ${emailDomain} does not match organization domain ${org.domain}`);
        return;
      }
    }

    setIsProcessing(true);
    try {
      // For this sandbox, we create the UserProfile record.
      // The user will "claim" it when they sign in with this email.
      // We use a specific ID if we want, or let Firestore generate it.
      // Here we check if user already exists in Auth or our profiles.
      const existing = allUsers.find(u => u.email.toLowerCase() === newUserEmail.toLowerCase());
      if (existing) {
        alert("A profile with this email already exists.");
        setIsProcessing(false);
        return;
      }

      const tempId = `temp_${Date.now()}`;
      await setDoc(doc(db, 'users', tempId), {
        uid: tempId,
        displayName: newUserName,
        email: newUserEmail.toLowerCase(),
        orgId: newUserOrgId,
        role: newUserRole,
        teamIds: [],
        createdAt: serverTimestamp(),
        isSuperAdmin: newUserRole === 'SUPER_ADMIN'
      });

      await addDoc(collection(db, 'auditLogs'), {
        userId: user.uid,
        userEmail: user.email,
        action: 'USER_PRE_CREATE',
        targetId: tempId,
        metadata: { email: newUserEmail, orgId: newUserOrgId, role: newUserRole },
        createdAt: serverTimestamp()
      });

      setShowCreateUser(false);
      setNewUserName('');
      setNewUserEmail('');
      setNewUserOrgId('');
      setNewUserRole('ORG_ADMIN');
    } catch (e) { handleFirestoreError(e, OperationType.WRITE, 'users'); }
    finally { setIsProcessing(false); }
  };

  const [showUserManage, setShowUserManage] = useState(false);
  const [userToManage, setUserToManage] = useState<UserProfile | null>(null);

  const handleUpdateUserRole = async (uid: string, orgId: string, role: UserRole) => {
    if (!isSuperAdmin || !user) return;
    setIsProcessing(true);
    try {
      await updateDoc(doc(db, 'users', uid), {
        orgId,
        role,
        updatedAt: serverTimestamp()
      });

      await addDoc(collection(db, 'auditLogs'), {
        userId: user.uid,
        userEmail: user.email,
        action: 'USER_ROLE_UPDATE',
        targetId: uid,
        metadata: { orgId, role },
        createdAt: serverTimestamp()
      });

      setShowUserManage(false);
      setUserToManage(null);
    } catch (e) { handleFirestoreError(e, OperationType.UPDATE, 'users'); }
    finally { setIsProcessing(false); }
  };

  // Data Correction for Super Admin
  React.useEffect(() => {
    if (user && user.email === 'neerajkumarkhatri.ai@gmail.com' && userProfile && userProfile.role !== 'SUPER_ADMIN') {
      console.log('Patching Super Admin profile...');
      updateDoc(doc(db, 'users', user.uid), {
        orgId: 'global',
        role: 'SUPER_ADMIN',
        isSuperAdmin: true
      });
    }
  }, [user, userProfile]);

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
  const [foundDuplicates, setFoundDuplicates] = useState<any[]>([]);

  // Auth Listener
  React.useEffect(() => {
    const hasSignedOut = localStorage.getItem('initial_signout_landing');
    if (!hasSignedOut) {
      signOut();
      localStorage.setItem('initial_signout_landing', 'true');
    }
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

  // Fetch Projects
  React.useEffect(() => {
    if (!activeUserId || !userProfile) return;
    
    let q;
    if (isSuperAdmin && !impersonatedUser) {
      // Super Admin sees ALL projects globally
      q = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
    } else if (activeOrgId) {
      // Regular user or impersonated context sees ORG projects
      q = query(collection(db, 'projects'), where('orgId', '==', activeOrgId), orderBy('createdAt', 'desc'));
    } else {
      // Fallback to personal projects
      q = query(collection(db, 'projects'), where('createdBy', '==', activeUserId), orderBy('createdAt', 'desc'));
    }

    return onSnapshot(q, (snapshot) => {
      setProjects(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Project)));
    });
  }, [activeUserId, activeOrgId, isSuperAdmin, impersonatedUser, userProfile]);

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
    if (!newProjectName || !user || !userProfile) return;
    setIsProcessing(true);
    try {
      const domain = user.email?.split('@')[1] || '';
      await addDoc(collection(db, 'projects'), {
        name: newProjectName,
        orgId: activeOrgId || userProfile.orgId, // Create in current context
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        creatorDomain: domain
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
        status: 'open' as const,
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
    setFoundDuplicates([]);
    try {
      const analysis = await recruitmentEngine.evaluateCandidates(
        currentJob.rawDescription,
        resumes.map((r) => r.text)
      );
      
      const duplicates: any[] = [];
      const newEvaluations: any[] = [];

      for (const candidate of analysis.candidates) {
        // Check global duplicates
        const globalDupe = allEvaluations.find(e => e.email === candidate.email);
        const localDupe = evaluations.find(e => e.email === candidate.email);

        if (globalDupe || localDupe) {
          duplicates.push({ 
            ...candidate, 
            existingId: globalDupe?.id || localDupe?.id,
            existingJobId: globalDupe?.jobId || selectedJobId,
            existingProjectId: globalDupe?.projectId || selectedProjectId
          });
          continue;
        }

        const evalData: Partial<CandidateEvaluation> = {
          ...candidate,
          status: 'New',
          createdAt: serverTimestamp() as any
        };
        newEvaluations.push(evalData);
      }

      // Batch add new ones
      for (const evalData of newEvaluations) {
        await addDoc(collection(db, 'projects', selectedProjectId, 'jobs', selectedJobId, 'evaluations'), evalData);
      }
      
      if (duplicates.length > 0) {
        setFoundDuplicates(duplicates);
      }
      
      setResumes([]); 
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `projects/${selectedProjectId}/jobs/${selectedJobId}/evaluations`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLinkDuplicate = async (candidate: any) => {
    if (!selectedProjectId || !selectedJobId) return;
    try {
      const evalData: any = {
        ...candidate,
        status: 'New',
        createdAt: serverTimestamp() as any
      };
      delete evalData.existingId;
      delete evalData.existingJobId;
      delete evalData.existingProjectId;

      await addDoc(collection(db, 'projects', selectedProjectId, 'jobs', selectedJobId, 'evaluations'), evalData as CandidateEvaluation);
      setFoundDuplicates(prev => prev.filter(d => d.email !== candidate.email));
    } catch (e) { handleFirestoreError(e, OperationType.WRITE, 'evaluations'); }
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

  const toggleJobStatus = async (job: Job) => {
    if (!selectedProjectId || !job.id) return;
    try {
      await setDoc(doc(db, 'projects', selectedProjectId, 'jobs', job.id), {
        status: job.status === 'open' ? 'closed' : 'open' as const,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (e) { handleFirestoreError(e, OperationType.UPDATE, 'jobs'); }
  };

  const deleteJob = async (jobId: string) => {
    if (!selectedProjectId) return;
    if (!confirm('Are you sure you want to delete this JD and all its evaluations?')) return;
    try {
      await deleteDoc(doc(db, 'projects', selectedProjectId, 'jobs', jobId));
      setSelectedJobId(null);
    } catch (e) { handleFirestoreError(e, OperationType.DELETE, 'jobs'); }
  };

  const deleteProject = async (projectId: string) => {
    if (!confirm('Are you sure you want to delete this Project and all its JDs? This action is IRREVERSIBLE.')) return;
    try {
      await deleteDoc(doc(db, 'projects', projectId));
      if (selectedProjectId === projectId) {
        setSelectedProjectId(null);
        setSelectedJobId(null);
      }
    } catch (e) { handleFirestoreError(e, OperationType.DELETE, 'projects'); }
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
    <div className="min-h-screen bg-slate-100 font-sans text-slate-900 flex flex-col overflow-hidden">
      {/* Top Header */}
      <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between z-40 shadow-sm relative shrink-0">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center font-bold text-xs text-white">RE</div>
            <h1 className="font-bold text-sm text-slate-900">RecruitIntel</h1>
          </div>
          
          <nav className="flex items-center gap-1">
            {[
              { id: 'projects', label: 'Projects', icon: LayoutDashboard },
              { id: 'manage', label: 'Manage', icon: Settings2 },
              { id: 'closed', label: 'Closed JDs', icon: Archive }
            ].concat(isSuperAdmin ? [{ id: 'admin', label: 'Admin Center', icon: ShieldAlert }] : [] as any).map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={cn(
                  "flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
                  activeTab === tab.id ? "bg-indigo-50 text-indigo-600" : "text-slate-500 hover:bg-slate-50"
                )}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-6">
          {impersonatedUser && (
            <div className="flex items-center gap-2 px-3 py-1 bg-rose-50 border border-rose-100 rounded-full">
              <span className="text-[10px] font-black text-rose-600 uppercase tracking-tighter">Impersonating:</span>
              <span className="text-[10px] font-bold text-slate-700">{impersonatedUser.email}</span>
              <button 
                onClick={stopImpersonation}
                className="w-5 h-5 bg-rose-500 text-white rounded-full flex items-center justify-center hover:bg-rose-600 transition-colors"
                title="Exit Impersonation"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          <div className="relative">
            <button 
              onClick={() => setShowNotifications(!showNotifications)}
              className="p-2 text-slate-400 hover:text-slate-900 transition-colors relative"
            >
              <Bell className="w-5 h-5" />
              {notifications.some(n => !n.read) && (
                <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-rose-500 border-2 border-white rounded-full" />
              )}
            </button>
            
            <AnimatePresence>
              {showNotifications && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden"
                >
                  <div className="p-4 border-b border-slate-50 flex items-center justify-between">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Activity center</h4>
                    <button className="text-[10px] font-bold text-indigo-600">Clear All</button>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto no-scrollbar">
                    {notifications.map(n => (
                      <div key={n.id} className="p-4 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0 relative group">
                        {!n.read && <div className="absolute left-1 top-1/2 -translate-y-1/2 w-1 h-8 bg-indigo-500 rounded-full" />}
                        <p className="text-xs font-medium text-slate-700 leading-snug">{n.text}</p>
                        <span className="text-[9px] text-slate-400 mt-1 block uppercase font-bold tracking-tighter">{n.time}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex items-center gap-3 pl-6 border-l border-slate-100">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-bold text-slate-900">
                {user.displayName}
                {isSuperAdmin && <span className="ml-2 text-[8px] bg-indigo-600 text-white px-1 py-0.5 rounded uppercase">Super Admin</span>}
              </div>
              <button onClick={() => signOut()} className="text-[10px] font-black text-rose-500 uppercase tracking-widest hover:text-rose-600 transition-colors">Sign Out</button>
            </div>
            <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border border-slate-100" />
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: Sub-navigation */}
        <aside className="w-64 bg-white border-r border-slate-200 p-6 overflow-y-auto shrink-0 flex flex-col no-scrollbar">
          <div className="flex items-center justify-between mb-8 px-2">
            <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
              {activeTab === 'projects' ? 'Project List' : activeTab === 'manage' ? 'Management' : 'Archive'}
            </h2>
            <button onClick={() => setShowCreateProject(true)} className="text-indigo-600 hover:text-indigo-800 transition-colors">
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
                    "w-full text-left px-3 py-2.5 rounded-xl transition-all flex items-center justify-between group",
                    selectedProjectId === p.id ? "bg-slate-900 text-white shadow-lg shadow-slate-900/10" : "text-slate-500 hover:bg-slate-50"
                  )}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <FolderOpen className={cn("w-4 h-4 shrink-0", selectedProjectId === p.id ? "text-indigo-400" : "text-slate-300")} />
                    <span className="text-[13px] font-bold truncate">{p.name}</span>
                  </div>
                  {selectedProjectId === p.id ? <ChevronDown className="w-3.5 h-3.5 text-slate-500" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-300 opacity-0 group-hover:opacity-100" />}
                </button>
                
                {selectedProjectId === p.id && (
                  <div className="pl-4 mt-2 mb-4 space-y-1 border-l-2 border-slate-100 ml-5 py-1">
                    {jobs.filter(j => activeTab === 'closed' ? j.status === 'closed' : j.status === 'open').map(j => (
                      <button 
                        key={j.id}
                        onClick={() => setSelectedJobId(j.id || null)}
                        className={cn(
                          "w-full text-left px-3 py-2 rounded-lg transition-all text-[11px] flex items-center justify-between group/jd relative",
                          selectedJobId === j.id ? "bg-indigo-50 text-indigo-700 font-bold" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                        )}
                      >
                        <div className="flex flex-col min-w-0">
                          <span className="truncate">{j.title}</span>
                          {j.reqId && <span className="text-[9px] opacity-60 font-black tracking-widest">{j.reqId}</span>}
                        </div>
                        {selectedJobId === j.id && <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full shadow-lg shadow-indigo-500/50" />}
                      </button>
                    ))}
                    <button 
                      onClick={() => setShowCreateJob(true)}
                      className="w-full text-left px-3 py-2 text-indigo-600 hover:text-indigo-800 transition-colors text-[10px] font-black uppercase tracking-widest flex items-center gap-2"
                    >
                      <Plus className="w-3 h-3" /> Create JD
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-auto p-4 bg-slate-50 rounded-2xl border border-slate-100">
             <div className="flex items-center gap-2 mb-2">
                <ShieldAlert className="w-3 h-3 text-indigo-500" />
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Security Node</span>
             </div>
             <p className="text-[10px] text-slate-500 leading-tight font-medium">All intelligence data is encrypted and verified against registry integrity.</p>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto bg-slate-50 p-10 relative no-scrollbar">
          {activeTab === 'admin' && isSuperAdmin ? (
            <div className="max-w-6xl mx-auto space-y-12">
               <div>
                  <h2 className="text-4xl font-black tracking-tighter uppercase mb-2">Global Registry Control</h2>
                  <p className="text-slate-500 text-lg font-medium">Systems administration and multi-tenant telemetry.</p>
               </div>

               {/* Organizations Overview */}
               <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 space-y-6">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">Tenants ({organizations.length})</h3>
                      <button 
                        onClick={() => setShowCreateOrg(true)}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20"
                      >
                        + Add Organization
                      </button>
                    </div>
                    <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="bg-slate-50 text-[10px] uppercase font-black tracking-widest text-slate-400 border-b border-slate-100">
                            <th className="px-6 py-4">Organization</th>
                            <th className="px-6 py-4">Status</th>
                            <th className="px-6 py-4">Created</th>
                            <th className="px-6 py-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50 text-xs font-bold text-slate-600">
                          {organizations.map(org => (
                            <tr key={org.id} className="hover:bg-slate-50 transition-colors">
                              <td className="px-6 py-4">
                                <div className="font-black text-slate-900">{org.name}</div>
                                <div className="text-[10px] text-slate-400 font-mono italic">{org.subdomain}</div>
                              </td>
                              <td className="px-6 py-4">
                                <span className={cn("px-2 py-0.5 rounded-full text-[8px] uppercase tracking-tighter", 
                                  org.status === 'active' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
                                )}>{org.status}</span>
                              </td>
                              <td className="px-6 py-4 text-slate-400">
                                {new Date(org.createdAt?.seconds * 1000).toLocaleDateString()}
                              </td>
                              <td className="px-6 py-4 text-right">
                                <button className="p-2 text-slate-400 hover:text-indigo-600"><Settings2 className="w-4 h-4" /></button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-black uppercase tracking-widest text-slate-400">User Registry ({allUsers.length})</h3>
                      <button 
                        onClick={() => setShowCreateUser(true)}
                        className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all"
                      >
                        + Create User
                      </button>
                    </div>
                    <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm max-h-[600px] overflow-y-auto no-scrollbar">
                      <div className="divide-y divide-slate-50">
                        {allUsers.map(u => (
                          <div key={u.uid} className="p-4 hover:bg-slate-50 transition-colors group">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 font-black text-[10px]">
                                  {u.displayName?.substring(0, 2).toUpperCase()}
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-xs font-black text-slate-900 leading-none">{u.displayName}</span>
                                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">{u.role}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <button 
                                  onClick={() => { setUserToManage(u); setShowUserManage(true); }}
                                  className="p-1.5 text-slate-400 hover:text-indigo-600 transition-colors"
                                  title="Manage User Roles"
                                >
                                  <Settings2 className="w-3 h-3" />
                                </button>
                                <button 
                                  onClick={() => startImpersonation(u)}
                                  className={cn(
                                    "px-2 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest transition-all",
                                    u.uid === user?.uid 
                                      ? "bg-slate-50 text-slate-300 pointer-events-none" 
                                      : "bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white"
                                  )}
                                >
                                  {u.uid === user?.uid ? "You" : "Login As"}
                                </button>
                              </div>
                            </div>
                            <div className="text-[9px] text-slate-400 font-medium ml-11">{u.email}</div>
                            <div className="mt-2 ml-11">
                              <span className="text-[7px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-black uppercase tracking-tighter">
                                Org: {organizations.find(o => o.id === u.orgId)?.name || 'Unknown'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
               </div>
            </div>
          ) : activeTab === 'manage' ? (
            <div className="max-w-4xl mx-auto space-y-8 pb-10">
               <div>
                  <h2 className="text-3xl font-black tracking-tighter uppercase mb-2">Workspace Management</h2>
                  <p className="text-slate-500 text-sm font-medium">Coordinate your projects and job intelligence profiles from a centralized registry.</p>
               </div>

               <div className="grid gap-6">
                  {projects.map(p => (
                    <div key={p.id} className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition-all">
                       <div className="p-6 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                          <div className="flex items-center gap-4">
                             <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600"><FolderOpen className="w-5 h-5" /></div>
                             <h3 className="font-black text-slate-900 tracking-tight">{p.name}</h3>
                          </div>
                          <div className="flex items-center gap-2">
                             <button onClick={() => { setSelectedProjectId(p.id!); setShowCreateJob(true); }} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-indigo-600/10 hover:bg-indigo-700 transition-all">Deploy JD</button>
                             <button 
                               onClick={() => deleteProject(p.id!)}
                               className="p-2 text-slate-400 hover:text-rose-500 transition-colors"
                             >
                                <Trash2 className="w-5 h-5" />
                             </button>
                          </div>
                       </div>
                       <div className="p-4 space-y-2">
                          {jobs.filter(j => j.projectId === p.id).map(j => (
                             <div key={j.id} className="flex items-center justify-between p-4 bg-white border border-slate-100 rounded-2xl hover:border-slate-300 transition-all group">
                                <div className="flex items-center gap-4">
                                   <div className={cn("w-2 h-2 rounded-full", j.status === 'open' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-slate-300')} />
                                   <div>
                                      <div className="text-sm font-bold text-slate-900">{j.title}</div>
                                      <div className="text-[10px] text-slate-400 font-mono">#{j.reqId}</div>
                                   </div>
                                </div>
                                <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                   <button 
                                      onClick={() => toggleJobStatus(j)}
                                      className={cn("px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all", 
                                        j.status === 'open' ? 'bg-slate-100 text-slate-600 hover:bg-slate-900 hover:text-white' : 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200'
                                      )}
                                   >
                                      {j.status === 'open' ? 'Archive' : 'Re-open'}
                                   </button>
                                   <button 
                                      onClick={() => deleteJob(j.id!)}
                                      className="p-2 text-slate-400 hover:text-rose-500 transition-colors"
                                   >
                                      <Trash2 className="w-4 h-4" />
                                   </button>
                                </div>
                             </div>
                          ))}
                          {jobs.filter(j => j.projectId === p.id).length === 0 && (
                            <div className="p-8 text-center border-2 border-dashed border-slate-100 rounded-2xl">
                               <p className="text-[10px] text-slate-300 font-black uppercase tracking-widest">No intelligence profiles deployed</p>
                            </div>
                          )}
                       </div>
                    </div>
                  ))}
               </div>
            </div>
          ) : !selectedJobId ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-sm mx-auto">
              <div className="mb-6 p-6 bg-white rounded-3xl shadow-2xl shadow-slate-200 border border-slate-100">
                {activeTab === 'closed' ? <FolderLock className="w-8 h-8 text-slate-200" /> : <Plus className="w-8 h-8 text-slate-200" />}
              </div>
              <h2 className="text-xl font-black mb-2 uppercase tracking-tight">
                {activeTab === 'closed' ? 'No Archived Profiles' : 'Select a Job Profile'}
              </h2>
              <p className="text-sm text-slate-500 font-medium leading-relaxed">
                {activeTab === 'closed' 
                  ? 'Archive inactive job descriptions to keep your workspace clean and organized.'
                  : 'Launch candidates analysis by choosing a recruitment profile from your registry.'
                }
              </p>
            </div>
          ) : (
            <div className="max-w-6xl mx-auto space-y-8">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-black tracking-tight flex items-center gap-3 capitalize group">
                    {currentJob?.title}
                    {currentJob?.reqId && (
                      <span className="text-[10px] bg-indigo-50 text-indigo-500 px-2 py-0.5 rounded font-black tracking-widest uppercase">{currentJob.reqId}</span>
                    )}
                    <button onClick={() => {
                      setNewJobTitle(currentJob?.title || '');
                      setNewJobReqId(currentJob?.reqId || '');
                      setNewJobJd(currentJob?.rawDescription || '');
                      setShowEditJob(true);
                    }} className="p-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-sm opacity-0 group-hover:opacity-100">
                      <Edit className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                  </h2>
                  <div className="flex items-center gap-2 mt-1.5 text-[11px] text-slate-400 font-bold uppercase tracking-widest">
                    <FolderOpen className="w-3.5 h-3.5" />
                    {currentProject?.name}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div {...getRootProps()} className="px-6 py-2.5 bg-white border border-slate-200 rounded-2xl cursor-pointer hover:border-indigo-400 hover:shadow-xl hover:shadow-indigo-600/5 transition-all flex items-center gap-3 group">
                    <input {...getInputProps()} />
                    <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                      <Upload className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-[10px] font-black text-slate-900 uppercase tracking-widest block">Queue Resumes</span>
                      <span className="text-[9px] text-slate-400 font-bold uppercase">{resumes.length} files attached</span>
                    </div>
                  </div>
                  {resumes.length > 0 && (
                    <button 
                      onClick={handleEvaluate} 
                      disabled={isProcessing}
                      className="px-8 py-3 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-indigo-600/20 hover:bg-indigo-700 transition-all hover:-translate-y-0.5 active:translate-y-0"
                    >
                      {isProcessing ? "INITIALIZING SECURE ENGINE..." : "RUN AI ANALYSIS"}
                    </button>
                  )}
                </div>
              </div>

              {/* Candidate List (Table Format) */}
              <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-8 border-b border-slate-50 flex items-center justify-between bg-slate-50/30">
                  <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                    <Users className="w-4 h-4 text-indigo-500" /> Talent Pool Matrix
                  </h3>
                  <div className="flex items-center gap-2">
                     <span className="px-3 py-1 bg-white border border-slate-200 rounded-full text-[9px] font-black text-slate-400 uppercase tracking-widest shadow-sm">{evaluations.length} Candidates Detected</span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/50 text-[10px] uppercase font-black tracking-widest text-slate-400 border-b border-slate-100">
                        <th className="px-10 py-5">Candidate profile</th>
                        <th className="px-10 py-5">Current location</th>
                        <th className="px-10 py-5">Enterprise context</th>
                        <th className="px-10 py-5 text-center">Score index</th>
                        <th className="px-10 py-5 text-right">Operation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {evaluations.map((cand) => (
                        <tr key={cand.id} className="hover:bg-slate-50/80 transition-all group">
                          <td className="px-10 py-6">
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center gap-2">
                                 <span className="font-black text-[15px] text-slate-900 tracking-tight">{cand.name}</span>
                                 {(() => {
                                    const dupe = checkDuplicate(cand.email, cand.id!);
                                    if (!dupe) return null;
                                    return (
                                      <button 
                                        onClick={() => {
                                          setActiveCandidateId(dupe.id || null);
                                          setShowCandidateDetails(true);
                                        }}
                                        className="px-2 py-0.5 bg-rose-50 text-rose-600 rounded-md border border-rose-100 flex items-center gap-1.5 hover:bg-rose-100 transition-all group/dupe"
                                      >
                                         <AlertCircle className="w-2.5 h-2.5" />
                                         <span className="text-[8px] font-black uppercase tracking-tighter">Integrity Alert: Multi-Node Found</span>
                                      </button>
                                    );
                                 })()}
                              </div>
                              <div className="flex items-center gap-3">
                                <select 
                                  value={cand.status}
                                  onChange={(e) => updateCandidateStatus(cand.id!, e.target.value as HiringStatus)}
                                  className={cn("text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-lg border border-transparent outline-none cursor-pointer shadow-sm", getStatusColor(cand.status))}
                                >
                                  {['New', 'Screening', 'Interview', 'Offered', 'Hired', 'Rejected'].map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                                <span className="text-[10px] text-slate-400 font-bold truncate max-w-[150px] uppercase tracking-tight">{cand.email}</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-10 py-6 text-xs text-slate-500 font-bold uppercase tracking-tight">{cand.location || 'N/A'}</td>
                          <td className="px-10 py-6 text-xs text-slate-500 font-bold uppercase tracking-tight">{cand.currentCompany || 'N/A'}</td>
                          <td className="px-10 py-6">
                            <div className="flex justify-center">
                              <div className={cn("w-11 h-11 rounded-2xl flex items-center justify-center font-black text-sm shadow-inner border border-white", getScoreColor(cand.score))}>
                                {cand.score}
                              </div>
                            </div>
                          </td>
                          <td className="px-10 py-6 text-right">
                            <div className="flex items-center justify-end gap-3">
                              <button 
                                onClick={() => setShowMoveCandidate(cand.id || null)}
                                className="p-3 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-indigo-600 hover:border-indigo-200 transition-all shadow-sm group-hover:scale-105 active:scale-95"
                                title="Move/Link Candidate"
                              >
                                <ArrowLeftRight className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => { setActiveCandidateId(cand.id || null); setShowCandidateDetails(true); }}
                                className="inline-flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-slate-900/10 hover:bg-indigo-600 transition-all group-hover:scale-105 active:scale-95"
                              >
                                View Report
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
      </div>

      {/* Modals */}
      <AnimatePresence>
        {/* User Management Modal */}
        {showUserManage && userToManage && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-[2rem] p-10 max-w-md w-full shadow-2xl relative">
              <button onClick={() => setShowUserManage(false)} className="absolute top-6 right-6 p-2 text-slate-400 hover:text-slate-900 transition-colors"><X className="w-5 h-5" /></button>
              <h2 className="text-2xl font-black text-slate-900 mb-2 tracking-tight uppercase">Manage Identity</h2>
              <p className="text-slate-500 font-medium mb-8 text-sm">Update domain context and access privilege for {userToManage.displayName}.</p>
              
              <div className="space-y-6">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Organization Assignment</label>
                  <select 
                    value={userToManage.orgId}
                    onChange={(e) => setUserToManage({ ...userToManage, orgId: e.target.value })}
                    className="w-full px-5 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all font-bold"
                  >
                    <option value="global">Global (System)</option>
                    <option value="default-org">Default Sandbox</option>
                    {organizations.map(org => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">System Role</label>
                  <select 
                    value={userToManage.role}
                    onChange={(e) => setUserToManage({ ...userToManage, role: e.target.value as UserRole })}
                    className="w-full px-5 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all font-bold"
                  >
                    <option value="TEAM_MEMBER">Team Member</option>
                    <option value="ORG_ADMIN">Organization Admin</option>
                    <option value="SUPER_ADMIN">Global Super Admin</option>
                  </select>
                </div>
              </div>

              <button 
                onClick={() => handleUpdateUserRole(userToManage.uid, userToManage.orgId, userToManage.role)}
                disabled={isProcessing}
                className="w-full mt-8 py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-indigo-600/20 hover:bg-indigo-700 transition-all disabled:opacity-50"
              >
                {isProcessing ? "SAVING..." : "SAVE ASSIGNMENT"}
              </button>
            </motion.div>
          </motion.div>
        )}

        {/* Create Organization Modal */}
        {showCreateOrg && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-[2rem] p-10 max-w-md w-full shadow-2xl relative">
              <button onClick={() => setShowCreateOrg(false)} className="absolute top-6 right-6 p-2 text-slate-400 hover:text-slate-900 transition-colors"><X className="w-5 h-5" /></button>
              <h2 className="text-2xl font-black text-slate-900 mb-2 tracking-tight uppercase">Provision Tenant</h2>
              <p className="text-slate-500 font-medium mb-8 text-sm">Initialize a new secure organization environment.</p>
              
              <div className="space-y-6">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Organization Name</label>
                  <input 
                    type="text" 
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                    className="w-full px-5 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all font-bold"
                    placeholder="e.g. Acme Corp"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Verified Domain</label>
                  <input 
                    type="text" 
                    value={newOrgDomain}
                    onChange={(e) => setNewOrgDomain(e.target.value)}
                    className="w-full px-5 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all font-bold"
                    placeholder="e.g. acme.com"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Subdomain Mapping</label>
                  <div className="flex items-center gap-2">
                    <input 
                      type="text" 
                      value={newOrgSubdomain}
                      onChange={(e) => setNewOrgSubdomain(e.target.value)}
                      className="flex-1 px-5 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all font-bold"
                      placeholder="acme-corp"
                    />
                    <span className="text-[10px] font-black text-slate-300 uppercase">.ri.cloud</span>
                  </div>
                </div>
              </div>

              <button 
                onClick={handleCreateOrg}
                disabled={isProcessing || !newOrgName || !newOrgDomain}
                className="w-full mt-8 py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-indigo-600/20 hover:bg-indigo-700 transition-all disabled:opacity-50"
              >
                {isProcessing ? "PROVISIONING..." : "CREATE ORGANIZATION"}
              </button>
            </motion.div>
          </motion.div>
        )}

        {/* Create User Modal */}
        {showCreateUser && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-[2rem] p-10 max-w-md w-full shadow-2xl relative">
              <button onClick={() => setShowCreateUser(false)} className="absolute top-6 right-6 p-2 text-slate-400 hover:text-slate-900 transition-colors"><X className="w-5 h-5" /></button>
              <h2 className="text-2xl font-black text-slate-900 mb-2 tracking-tight uppercase">Onboard User</h2>
              <p className="text-slate-500 font-medium mb-8 text-sm">Provision a new identity for the platform.</p>
              
              <div className="space-y-6">
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Full Name</label>
                  <input 
                    type="text" 
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    className="w-full px-5 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all font-bold"
                    placeholder="John Doe"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Email Address</label>
                  <input 
                    type="email" 
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    className="w-full px-5 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all font-bold"
                    placeholder="john@company.com"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">Organization</label>
                  <select 
                    value={newUserOrgId}
                    onChange={(e) => setNewUserOrgId(e.target.value)}
                    className="w-full px-5 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all font-bold"
                  >
                    <option value="">Select Organization</option>
                    <option value="global">Global (System)</option>
                    {organizations.map(org => (
                      <option key={org.id} value={org.id}>{org.name} ({org.domain})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">System Role</label>
                  <select 
                    value={newUserRole}
                    onChange={(e) => setNewUserRole(e.target.value as UserRole)}
                    className="w-full px-5 py-3.5 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all font-bold"
                  >
                    <option value="TEAM_MEMBER">Team Member</option>
                    <option value="ORG_ADMIN">Organization Admin</option>
                    <option value="SUPER_ADMIN">Global Super Admin</option>
                  </select>
                </div>
              </div>

              <button 
                onClick={handleCreateUser}
                disabled={isProcessing || !newUserName || !newUserEmail || !newUserOrgId}
                className="w-full mt-8 py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-indigo-600/20 hover:bg-indigo-700 transition-all disabled:opacity-50"
              >
                {isProcessing ? "CREATING..." : "PROVISION USER"}
              </button>
            </motion.div>
          </motion.div>
        )}

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
        {/* Duplicate Intelligence Modal */}
        {foundDuplicates.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-slate-900/80 backdrop-blur-md">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-[2.5rem] p-10 max-w-2xl w-full shadow-2xl relative">
              <div className="w-16 h-16 bg-rose-100 rounded-2xl flex items-center justify-center mb-8">
                <AlertCircle className="w-8 h-8 text-rose-600" />
              </div>
              <h2 className="text-3xl font-black text-slate-900 mb-2 tracking-tighter uppercase">Duplicate Intelligence</h2>
              <p className="text-slate-500 font-medium mb-8 leading-relaxed">
                We've detected candidates in this analysis who already exist in your recruitment registry. 
                Choose how you'd like to proceed with these profiles.
              </p>
              
              <div className="space-y-4 max-h-[400px] overflow-y-auto no-scrollbar mb-8">
                {foundDuplicates.map((cand, idx) => (
                  <div key={idx} className="p-5 border border-slate-100 rounded-2xl flex items-center justify-between bg-slate-50/50">
                    <div className="flex flex-col">
                      <span className="text-sm font-black text-slate-900">{cand.name}</span>
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{cand.email}</span>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-rose-50 text-rose-600 rounded text-[7px] font-black uppercase tracking-tighter">Already Exists</span>
                        {cand.existingProjectId && (
                          <span className="text-[7px] text-slate-400 font-bold uppercase tracking-widest">
                            In {projects.find(p => p.id === cand.existingProjectId)?.name || 'Another Project'}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => {
                          setActiveCandidateId(cand.existingId || null);
                          setShowCandidateDetails(true);
                        }}
                        className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all"
                      >
                        View Report
                      </button>
                      <button 
                        onClick={() => handleLinkDuplicate(cand)}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-md shadow-indigo-600/10"
                      >
                        Link to this JD
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button 
                onClick={() => setFoundDuplicates([])}
                className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-slate-800 transition-all"
              >
                Close Intelligence Briefing
              </button>
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
