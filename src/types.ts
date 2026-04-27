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
  name: string;
  summary: string;
  score: number;
  verdict: string;
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
