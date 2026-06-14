import scoreItems from "@/data/generated/scoreItems.json";
import type {
  ChecklistItem,
  ClinicalEngineInput,
  ClinicalEngineOutput,
  DiagnosisAssessment,
  DiagnosisNode,
  DiagnosisStatus,
  RedFlagAssessment,
  RedFlagGate,
  ScoreAssessment,
  ScoreItem
} from "@/types/clinical";

const SAFETY_NOTE = "의료진 보조용이며 최종 판단과 치료/검사 결정은 의료진 책임입니다.";

function isRedFlagDiagnosis(diagnosis: Pick<DiagnosisNode, "priority" | "mustNotMissGate">) {
  const priority = diagnosis.priority.toLowerCase();
  return (
    priority.includes("immediate") ||
    priority.includes("life") ||
    priority.includes("high") ||
    diagnosis.mustNotMissGate.trim().length > 0
  );
}

function statusLabel(status: DiagnosisStatus) {
  switch (status) {
    case "active_concern":
      return "가능성 높음";
    case "information_needed":
      return "정보 부족";
    case "low_probability":
      return "low probability";
    case "clinically_ruled_out":
      return "clinically ruled out";
    case "confirmed_or_likely":
      return "confirmed or likely";
    default:
      return "not evaluated";
  }
}

function firstSentence(text: string) {
  return text.split(/(?<=[.!?。])\s+|(?<=\.)|(?<=다\.)/).find(Boolean)?.trim() ?? text.trim();
}

function checklistMap(checklist: ChecklistItem[]) {
  return new Map(checklist.map((item) => [item.id, item]));
}

function presentEvidence(ids: string[], checklistById: Map<string, ChecklistItem>) {
  return ids
    .map((id) => checklistById.get(id))
    .filter((item): item is ChecklistItem => Boolean(item))
    .filter((item) => item.status === "present")
    .map((item) => item.label);
}

function unknownItems(ids: string[], checklistById: Map<string, ChecklistItem>) {
  return ids
    .map((id) => checklistById.get(id))
    .filter((item): item is ChecklistItem => Boolean(item))
    .filter((item) => item.status === "unknown")
    .map((item) => item.label)
    .slice(0, 4);
}

function assessStatus(diagnosis: DiagnosisNode, evidenceCount: number, unknownCount: number): DiagnosisStatus {
  if (evidenceCount >= 2) return "active_concern";
  if (evidenceCount === 1 && isRedFlagDiagnosis(diagnosis)) return "active_concern";
  if (evidenceCount === 1) return "information_needed";
  if (isRedFlagDiagnosis(diagnosis)) return "information_needed";
  if (unknownCount > 0) return "low_probability";
  return "not_evaluated";
}

function assessDiagnosis(diagnosis: DiagnosisNode, checklistById: Map<string, ChecklistItem>): DiagnosisAssessment {
  const ids = diagnosis.appKeyChecklistIds ?? [];
  const evidence = presentEvidence(ids, checklistById);
  const missingInformation = unknownItems(ids, checklistById);
  const status = assessStatus(diagnosis, evidence.length, missingInformation.length);
  const redFlag = isRedFlagDiagnosis(diagnosis);
  const priorityWeight = diagnosis.priority.includes("Immediate") ? 40 : diagnosis.priority.includes("High") ? 25 : 5;
  const rankScore = evidence.length * 20 + priorityWeight + Math.min(missingInformation.length, 4);

  return {
    diagnosisId: diagnosis.id,
    nameKo: diagnosis.nameKo,
    english: diagnosis.english,
    category: diagnosis.category,
    priority: diagnosis.priority,
    status,
    likelihoodLabel: statusLabel(status),
    isRedFlag: redFlag,
    evidence: evidence.length > 0 ? evidence : ["근거 부족 / 정보 부족"],
    missingInformation,
    sourceText: evidence.length > 0 ? diagnosis.suspicionClues : firstSentence(diagnosis.suspicionClues),
    pitfalls: diagnosis.pitfalls,
    rankScore
  };
}

function assessRedFlag(gate: RedFlagGate, checklistById: Map<string, ChecklistItem>): RedFlagAssessment {
  const evidence = presentEvidence(gate.appKeyChecklistIds, checklistById);
  const neededInformation = unknownItems(gate.appKeyChecklistIds, checklistById);
  const status: DiagnosisStatus = evidence.length > 0 ? "active_concern" : "information_needed";
  return {
    diagnosisId: gate.diagnosisId,
    nameKo: gate.nameKo,
    english: gate.english,
    category: gate.category,
    priority: gate.priority,
    status,
    likelihoodLabel: statusLabel(status),
    isRedFlag: true,
    evidence: evidence.length > 0 ? evidence : ["근거 부족 / 정보 부족"],
    missingInformation: neededInformation,
    neededInformation,
    mustNotMissGate: gate.mustNotMissGate,
    sourceText: evidence.length > 0 ? gate.suspicionClues : gate.initialEvaluation,
    pitfalls: gate.pitfalls,
    rankScore: evidence.length * 20 + 50
  };
}

function includesAny(text: string, terms: string[]) {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

function buildScoreAssessments(checklistById: Map<string, ChecklistItem>): ScoreAssessment[] {
  const allScoreItems = scoreItems as ScoreItem[];
  const groups = [
    { name: "HEART Pathway", terms: ["HEART", "EDACS", "GRACE", "cTn", "troponin"] },
    { name: "Wells PE", terms: ["Wells", "Geneva", "pretest probability"] },
    { name: "PERC", terms: ["PERC"] },
    { name: "ADD-RS", terms: ["ADD-RS", "aorta", "CTA chest"] },
    { name: "GRACE/HEART 관련 항목", terms: ["GRACE/HEART", "GRACE", "HEART"] }
  ];

  return groups.map((group) => {
    const items = allScoreItems.filter((item) =>
      includesAny(`${item.scoreItem} ${item.representativeSourceText} ${item.relatedDiagnosisNames.join(" ")}`, group.terms)
    );
    const hydrated = items.map((item) => ({
      ...item,
      status: checklistById.get(item.id)?.status ?? item.status
    }));
    const presentCount = hydrated.filter((item) => item.status === "present").length;
    const unknownLabels = hydrated
      .filter((item) => item.status === "unknown")
      .map((item) => item.scoreItem)
      .slice(0, 4);
    return {
      name: group.name,
      status: presentCount > 0 ? "계산 일부 가능" : "정보 부족",
      items: hydrated,
      missingInformation: unknownLabels.length > 0 ? unknownLabels : ["원본 기준 항목 확인 필요"],
      note: "계산식/threshold는 원본에 명시된 항목만 표시하며, 임의 계산은 수행하지 않습니다."
    };
  });
}

function uniqueCompact(values: string[], limit = 8) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, limit);
}

function recommendedFromAssessments(active: DiagnosisAssessment[], redFlags: RedFlagAssessment[]) {
  const lines = [
    ...redFlags.slice(0, 3).map((flag) => `${flag.nameKo}: ${firstSentence(flag.sourceText)}`),
    ...active.slice(0, 3).map((item) => `${item.nameKo}: ${firstSentence(item.sourceText)}`)
  ];
  return uniqueCompact(lines, 6).map((line) => `확인 필요: ${line}`);
}

export function runClinicalEngine(input: ClinicalEngineInput): ClinicalEngineOutput {
  const byId = checklistMap(input.checklist);
  const redFlags = input.redFlagGates
    .map((gate) => assessRedFlag(gate, byId))
    .filter((flag) => flag.status !== "clinically_ruled_out")
    .sort((a, b) => b.rankScore - a.rankScore);

  const activeDifferentials = input.diagnoses
    .map((diagnosis) => assessDiagnosis(diagnosis, byId))
    .filter((assessment) => assessment.status !== "not_evaluated")
    .sort((a, b) => b.rankScore - a.rankScore)
    .slice(0, 18);

  const scoreAssessments = buildScoreAssessments(byId);
  const top = activeDifferentials[0];
  const unresolvedRedFlags = redFlags
    .filter((flag) => flag.status !== "clinically_ruled_out")
    .map((flag) => flag.nameKo)
    .slice(0, 8);
  const missingInformation = uniqueCompact([
    ...redFlags.flatMap((flag) => flag.neededInformation),
    ...activeDifferentials.flatMap((diagnosis) => diagnosis.missingInformation)
  ], 10);
  const evidence = uniqueCompact(activeDifferentials.flatMap((diagnosis) => diagnosis.evidence), 8);
  const recommendedActions = recommendedFromAssessments(activeDifferentials, redFlags);

  return {
    redFlags,
    activeDifferentials,
    scoreAssessments,
    summary: {
      priorityDiagnosis: top?.nameKo ?? "정보 부족",
      unresolvedRedFlags,
      evidence: evidence.length > 0 ? evidence : ["근거 부족 / 정보 부족"],
      safetyNote: SAFETY_NOTE
    },
    missingInformation,
    recommendedActions
  };
}

export { SAFETY_NOTE };
