import { GoogleGenAI } from "@google/genai";
import { MultiCandidateAnalysis, JDStruct } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export const recruitmentEngine = {
  async evaluateCandidates(jdText: string, resumeTexts: string[]): Promise<MultiCandidateAnalysis> {
    const prompt = `
      You are an AI-powered Recruitment Intelligence Engine. Process the following Job Description (JD) and Candidate Resumes.
      
      ## JOB DESCRIPTION
      ${jdText}
      
      ## CANDIDATE RESUMES
      ${resumeTexts.map((r, i) => `### RESUME ${i + 1}\n${r}`).join('\n\n')}
      
      ## STRICT PROTOCOL
      1. Parse JD into JD_STRUCT.
      2. Parse EACH resume into CANDIDATE_STRUCT.
      3. CRITICAL: Meticulously extract candidate name, phone number, email ID, location, and current company. If any field is missing, use "N/A".
      4. Compare candidates strictly against MUST-HAVE skills.
      5. Penalize vague claims, buzzwords without metrics, and irrelevant experience.
      6. Scoring:
         - MUST_HAVE match (50% weight)
         - Relevant experience (20%)
         - Tools/Tech match (10%)
         - Achievements & impact (10%)
         - Stability & career progression (10%)
      7. Interpret scores: <60 Reject, 60-74 Risky, 75-89 Strong, 90+ Exceptional.
      8. For each candidate (unless rejected), generate a list of INTERVIEW QUESTIONS.
         - Ensure questions cover 100% of the MUST-HAVE skills listed in the JD.
         - Include a mix of Technical and Soft Skill categories.
         - For each question, provide an "idealAnswer" that the recruiter can use to verify the candidate's proficiency.
      9. Be brutally honest and evidence-driven. No sugarcoating.
      
      ## OUTPUT FORMAT
      Return a JSON object matching the MultiCandidateAnalysis schema:
      {
        "jd_struct": {
          "roleTitle": string, "experienceRange": string, "keyResponsibilities": string[], "mustHaveSkills": string[], "goodToHaveSkills": string[], 
          "toolsTechStack": string[], "domainIndustry": string, "seniorityLevel": string, "screeningCriteria": string[], "missingClarity": string[]
        },
        "candidates": [
          {
            "name": string, "phone": string, "email": string, "location": string, "currentCompany": string, "summary": string, "score": number, "verdict": string, "recommendation": string,
            "mustHaveAnalysis": [{"skill": string, "match": "YES"|"PARTIAL"|"NO", "evidence": string, "gap": string, "confidence": "High"|"Medium"|"Low"}],
            "goodToHaveAnalysis": [{"skill": string, "match": "YES"|"PARTIAL"|"NO", "evidence": string, "gap": string, "confidence": "High"|"Medium"|"Low"}],
            "strengths": string[], "weaknesses": string[],
            "riskAssessment": {"level": "Low"|"Medium"|"High", "justification": string},
            "interviewFocus": string[], "finalVerdict": string,
            "stabilityScore": number, "stabilityAnalysis": string,
            "interviewQuestions": [{"question": string, "category": "Technical"|"Soft Skill", "targetSkill": string, "idealAnswer": string}]
          }
        ],
        "ranking": [{"name": string, "score": number, "justification": string}],
        "shortlisted": ["Names only"],
        "rejected": ["Names only"]
      }
    `;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        }
      });

      const text = response.text;
      if (!text) throw new Error("No response from AI");
      
      const data = JSON.parse(text);
      return data as MultiCandidateAnalysis;
    } catch (error) {
      console.error("Evaluation Error:", error);
      throw new Error("Failed to process recruitment analysis. Ensure JD and Resumes are readable.");
    }
  },

  async structureJD(jdText: string): Promise<JDStruct> {
    const prompt = `
      Structurally analyze the following Job Description (JD).
      
      ## JOB DESCRIPTION
      ${jdText}
      
      ## OUTPUT FORMAT
      Return a JSON object:
      {
        "roleTitle", "experienceRange", "keyResponsibilities": [], "mustHaveSkills": [], "goodToHaveSkills": [], 
        "toolsTechStack": [], "domainIndustry", "seniorityLevel", "screeningCriteria": [], "missingClarity": []
      }
    `;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        }
      });

      const text = response.text;
      if (!text) throw new Error("No response from AI");
      return JSON.parse(text) as JDStruct;
    } catch (error) {
      console.error("JD Structuring Error:", error);
      throw new Error("Failed to structure JD.");
    }
  }
};
