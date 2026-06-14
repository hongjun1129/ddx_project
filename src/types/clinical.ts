export type RawClinicalRow = Record<string, string | number | boolean | null>;

export type ChecklistStatus = "unknown" | "present" | "absent" | "not_applicable";

export type DiagnosisStatus =
  | "not_evaluated"
  | "active_concern"
  | "information_needed"
  | "low_probability"
  | "clinically_ruled_out"
  | "confirmed_or_likely";

export interface DiagnosisNode {
  id: string;
  no: number;
  nameKo: string;
  english: string;
  category: string;
  priority: string;
  mustNotMissGate: string;
  suspicionClues: string;
  initialEvaluation: string;
  ruleIn: string;
  ruleOut: string;
  pitfalls: string;
  mimics: string;
  appChecklistKeys: string;
  sourceUrls: string[];
  evidenceLevel: string;
  reviewStatus: string;
  guidelineRationale: string;
  evidenceGrade: string;
  changeMemo: string;
  appKeyChecklistIds: string[];
  comprehensiveChecklistIds: string[];
  raw: RawClinicalRow;
  coverageRaw?: RawClinicalRow | null;
}

export interface ChecklistItem {
  id: string;
  section: string;
  label: string;
  status: ChecklistStatus;
  memo?: string;
  relatedDiagnosisCount?: number;
  relatedDiagnosisNames: string[];
  isRedFlagRelated: boolean;
  sourceExample?: string;
  impact?: string;
  sourceColumn?: string;
  representativeSourceText?: string;
  verbatim?: RawClinicalRow[];
  raw: RawClinicalRow;
}

export interface ChecklistProposal {
  itemId: string;
  itemLabel: string;
  proposedStatus: ChecklistStatus;
  evidenceText: string;
  confidence: number;
  action: "apply" | "modify" | "exclude";
  memo?: string;
}

export interface DiagnosisAssessment {
  diagnosisId: string;
  nameKo: string;
  english: string;
  category: string;
  priority: string;
  status: DiagnosisStatus;
  likelihoodLabel: string;
  isRedFlag: boolean;
  evidence: string[];
  missingInformation: string[];
  sourceText: string;
  pitfalls?: string;
  rankScore: number;
}

export interface RedFlagAssessment extends DiagnosisAssessment {
  neededInformation: string[];
  mustNotMissGate: string;
}

export interface ScoreItem {
  id: string;
  scoreItem: string;
  relatedDiagnosisNames: string[];
  sourceColumn: string;
  representativeSourceText: string;
  status: ChecklistStatus;
  memo?: string;
  raw: RawClinicalRow;
}

export interface ScoreAssessment {
  name: string;
  status: "정보 부족" | "계산 일부 가능" | "원문 항목 확인 필요";
  items: ScoreItem[];
  missingInformation: string[];
  note: string;
}

export interface ImplementationRule {
  id: string;
  rule: string;
  description: string;
  raw: RawClinicalRow;
}

export interface RedFlagGate {
  id: string;
  diagnosisId: string;
  no: number;
  nameKo: string;
  english: string;
  category: string;
  priority: string;
  mustNotMissGate: string;
  appChecklistKeys: string;
  appKeyChecklistIds: string[];
  comprehensiveChecklistIds: string[];
  suspicionClues: string;
  initialEvaluation: string;
  ruleIn: string;
  ruleOut: string;
  pitfalls: string;
  raw: RawClinicalRow;
}

export interface DispositionPath {
  id: string;
  riskGroup: string;
  definition: string;
  entryCriteria: string;
  disposition: string;
  additionalCardiacTesting: string;
  evidenceGrade: string;
  sourceKey: string;
  raw: RawClinicalRow;
}

export interface ClinicalEngineInput {
  checklist: ChecklistItem[];
  diagnoses: DiagnosisNode[];
  redFlagGates: RedFlagGate[];
  implementationRules: ImplementationRule[];
}

export interface ClinicalEngineOutput {
  redFlags: RedFlagAssessment[];
  activeDifferentials: DiagnosisAssessment[];
  scoreAssessments: ScoreAssessment[];
  summary: {
    priorityDiagnosis: string;
    unresolvedRedFlags: string[];
    evidence: string[];
    safetyNote: string;
  };
  missingInformation: string[];
  recommendedActions: string[];
}
