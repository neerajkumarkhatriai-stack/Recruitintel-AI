export type HiringStatus = 'New' | 'Screening' | 'Interview' | 'Offered' | 'Hired' | 'Rejected';

export interface Project {
  id?: string;
  name: string;
  createdAt: any;
  createdBy: string;
}

export interface Job {
  id?: string;
  projectId: string;
  title: string;
  reqId: string;
  rawDescription: string;
  structure: JDStruct | null;
  createdAt: any;
  createdBy: string;
}

export interface JDStruct {
  roleTitle: string;
  experienceRange: string;
  keyResponsibilities: string[];
  mustHaveSkills: string[];
  goodToHaveSkills: string[];
  toolsTechStack: string[];
  domainIndustry: string;
  seniorityLevel: 'Junior' | 'Mid' | 'Senior' | 'Lead/Executive';
  screeningCriteria: string[];
  missingClarity?: string[];
}

export interface CandidateEvaluation {
  id?: string;
  name: string;
  phone: string;
  email: string;
  location: string;
  currentCompany: string;
  summary: string;
  score: number;
  verdict: string;
  status: HiringStatus;
  recommendation: 'STRONG HIRE' | 'HIRE' | 'BORDERLINE' | 'REJECT';
  mustHaveAnalysis: SkillAnalysis[];
  goodToHaveAnalysis: SkillAnalysis[];
  strengths: string[];
  weaknesses: string[];
  riskAssessment: {
    level: 'Low' | 'Medium' | 'High';
    justification: string;
  };
  interviewFocus: string[];
  finalVerdict: string;
  stabilityScore: number;
  stabilityAnalysis: string;
  interviewQuestions: InterviewQuestion[];
  createdAt?: any;
  updatedAt?: any;
}

export interface InterviewQuestion {
  question: string;
  category: 'Technical' | 'Soft Skill';
  targetSkill: string;
  idealAnswer: string;
}

export interface SkillAnalysis {
  skill: string;
  match: 'YES' | 'PARTIAL' | 'NO';
  evidence: string;
  gap?: string;
  confidence: 'High' | 'Medium' | 'Low';
}

export interface MultiCandidateAnalysis {
  jd_struct: JDStruct;
  candidates: CandidateEvaluation[];
  ranking: { name: string; score: number; justification: string }[];
  shortlisted: string[];
  rejected: string[];
}
