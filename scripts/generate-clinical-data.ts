import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import * as XLSX from "xlsx";

type CellValue = string | number | boolean | null;
type RawRow = Record<string, CellValue>;

const rootDir = process.cwd();
const workflowPath = path.join(rootDir, "chest_pain_ddx_workflow_v1_2.xlsx");
const checklistPath = path.join(rootDir, "chest_pain_differential_checklist_from_v1_2.xlsx");
const outputDir = path.join(rootDir, "src", "data", "generated");

const requiredSheets = {
  workflow: [
    "01_DDx_Master",
    "02_Sources",
    "03_Implementation_Rules",
    "04_Disposition"
  ],
  checklist: [
    "01_AppKey_Checklist",
    "02_Comprehensive_Checklist",
    "03_DDx_Coverage",
    "04_Map_Verbatim",
    "05_RedFlag_Gates",
    "06_Score_Items"
  ]
};

function normalizeCell(value: unknown): CellValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

function readWorkbook(filePath: string) {
  return XLSX.readFile(filePath, {
    cellDates: false,
    raw: false,
    dense: false
  });
}

function assertSheets(workbook: XLSX.WorkBook, names: string[], fileName: string) {
  const missing = names.filter((name) => !workbook.SheetNames.includes(name));
  if (missing.length > 0) {
    throw new Error(`${fileName} is missing required sheets: ${missing.join(", ")}`);
  }
}

function rowsAsMatrix(workbook: XLSX.WorkBook, sheetName: string): CellValue[][] {
  const worksheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<CellValue[]>(worksheet, {
    header: 1,
    defval: null,
    raw: false
  }).map((row) => row.map(normalizeCell));
}

function rowHasValue(row: CellValue[]) {
  return row.some((cell) => cell !== null && String(cell).trim() !== "");
}

function sheetToRecords(workbook: XLSX.WorkBook, sheetName: string, headerRowIndex = 0): RawRow[] {
  const matrix = rowsAsMatrix(workbook, sheetName);
  const header = (matrix[headerRowIndex] ?? []).map((cell) => String(cell ?? "").trim());
  return matrix.slice(headerRowIndex + 1).filter(rowHasValue).map((row) => {
    const record: RawRow = {};
    header.forEach((column, index) => {
      if (!column) return;
      record[column] = normalizeCell(row[index]);
    });
    return record;
  });
}

function sheetUsedRows(workbook: XLSX.WorkBook, sheetName: string) {
  const ref = workbook.Sheets[sheetName]?.["!ref"];
  if (!ref) return { range: null, usedRows: 0, usedColumns: 0 };
  const range = XLSX.utils.decode_range(ref);
  return {
    range: ref,
    usedRows: range.e.r - range.s.r + 1,
    usedColumns: range.e.c - range.s.c + 1
  };
}

async function sha256(filePath: string) {
  const data = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

function text(row: RawRow, key: string) {
  const value = row[key];
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function numberValue(row: RawRow, key: string) {
  const value = Number(text(row, key));
  return Number.isFinite(value) ? value : 0;
}

function splitList(value: CellValue | undefined) {
  if (value === null || value === undefined) return [];
  return String(value)
    .split(/;|\n|---/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitIds(value: CellValue | undefined) {
  if (value === null || value === undefined) return [];
  return String(value).match(/[A-Z]+-\d+/g) ?? [];
}

function parseUrls(value: CellValue | undefined) {
  if (value === null || value === undefined) return [];
  return String(value)
    .split(/;|\s+/)
    .map((part) => part.trim())
    .filter((part) => /^https?:\/\//i.test(part));
}

function diagnosisId(no: number) {
  return `DX-${String(no).padStart(3, "0")}`;
}

function checklistStatus(value: string) {
  if (value.includes("있음")) return "present";
  if (value.includes("없음")) return "absent";
  if (value.includes("해당")) return "not_applicable";
  return "unknown";
}

async function writeJson(fileName: string, data: unknown) {
  await fs.writeFile(path.join(outputDir, fileName), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });

  const workflow = readWorkbook(workflowPath);
  const checklist = readWorkbook(checklistPath);
  assertSheets(workflow, requiredSheets.workflow, path.basename(workflowPath));
  assertSheets(checklist, requiredSheets.checklist, path.basename(checklistPath));

  const ddxRows = sheetToRecords(workflow, "01_DDx_Master");
  const sourceRows = sheetToRecords(workflow, "02_Sources");
  const implementationRows = sheetToRecords(workflow, "03_Implementation_Rules");
  const dispositionRows = sheetToRecords(workflow, "04_Disposition", 3);

  const appKeyRows = sheetToRecords(checklist, "01_AppKey_Checklist");
  const comprehensiveRows = sheetToRecords(checklist, "02_Comprehensive_Checklist");
  const coverageRows = sheetToRecords(checklist, "03_DDx_Coverage");
  const mapVerbatimRows = sheetToRecords(checklist, "04_Map_Verbatim");
  const redFlagRows = sheetToRecords(checklist, "05_RedFlag_Gates");
  const scoreRows = sheetToRecords(checklist, "06_Score_Items");

  const coverageByNo = new Map(coverageRows.map((row) => [numberValue(row, "No"), row]));
  const mapByChecklistId = new Map<string, RawRow[]>();
  for (const row of mapVerbatimRows) {
    const id = text(row, "Checklist ID");
    if (!id) continue;
    mapByChecklistId.set(id, [...(mapByChecklistId.get(id) ?? []), row]);
  }

  const diagnoses = ddxRows.map((row) => {
    const no = numberValue(row, "No");
    const coverage = coverageByNo.get(no);
    return {
      id: diagnosisId(no),
      no,
      nameKo: text(row, "진단노드"),
      english: text(row, "English"),
      category: text(row, "분류"),
      priority: text(row, "우선도"),
      mustNotMissGate: text(row, "Must-not-miss gate"),
      suspicionClues: text(row, "확률 상승/의심 단서"),
      initialEvaluation: text(row, "첫 평가/기본 검사"),
      ruleIn: text(row, "Rule-in/확진 접근"),
      ruleOut: text(row, "Rule-out/배제 접근"),
      pitfalls: text(row, "예외/함정"),
      mimics: text(row, "감별/Mimics"),
      appChecklistKeys: text(row, "앱 체크리스트 키"),
      sourceUrls: parseUrls(row["주요 출처 URL"]),
      evidenceLevel: text(row, "근거 수준"),
      reviewStatus: text(row, "검토 상태"),
      guidelineRationale: text(row, "진단 1순위 근거(가이드라인)"),
      evidenceGrade: text(row, "근거등급(검증 COR/LOE)"),
      changeMemo: text(row, "v1.2 변경/검토 메모"),
      appKeyChecklistIds: splitIds(coverage?.["앱키 Checklist ID"]),
      comprehensiveChecklistIds: splitIds(coverage?.["전체 Checklist ID"]),
      raw: row,
      coverageRaw: coverage ?? null
    };
  });

  const appKeyChecklist = appKeyRows.map((row) => ({
    id: text(row, "Checklist ID"),
    section: text(row, "체크 섹션"),
    label: text(row, "앱 체크리스트 키(원문)"),
    status: checklistStatus(text(row, "평가값")),
    memo: text(row, "메모"),
    relatedDiagnosisCount: numberValue(row, "관련 진단 수"),
    relatedDiagnosisNames: splitList(row["관련 진단명"]),
    isRedFlagRelated: text(row, "Red/Must-not-miss 연관") === "예",
    sourceExample: text(row, "출처 앱키 셀 예시"),
    raw: row
  }));

  const comprehensiveChecklist = comprehensiveRows.map((row) => {
    const id = text(row, "Checklist ID");
    return {
      id,
      section: text(row, "체크 섹션"),
      label: text(row, "체크 항목(원문 기반)"),
      status: checklistStatus(text(row, "평가값")),
      memo: text(row, "메모"),
      relatedDiagnosisCount: numberValue(row, "관련 진단 수"),
      relatedDiagnosisNames: splitList(row["관련 진단명"]),
      isRedFlagRelated: text(row, "Red/Must-not-miss 연관") === "예",
      impact: text(row, "주요 영향"),
      sourceColumn: text(row, "출처 열"),
      representativeSourceText: text(row, "대표 원문 근거"),
      verbatim: mapByChecklistId.get(id) ?? [],
      raw: row
    };
  });

  const ddxCoverage = coverageRows.map((row) => ({
    diagnosisId: diagnosisId(numberValue(row, "No")),
    no: numberValue(row, "No"),
    nameKo: text(row, "진단노드"),
    english: text(row, "English"),
    appKeyChecklistIds: splitIds(row["앱키 Checklist ID"]),
    comprehensiveChecklistIds: splitIds(row["전체 Checklist ID"]),
    raw: row
  }));

  const redFlagGates = redFlagRows.map((row) => ({
    id: `RFG-${String(numberValue(row, "No")).padStart(3, "0")}`,
    diagnosisId: diagnosisId(numberValue(row, "No")),
    no: numberValue(row, "No"),
    nameKo: text(row, "진단노드"),
    english: text(row, "English"),
    category: text(row, "분류"),
    priority: text(row, "우선도"),
    mustNotMissGate: text(row, "Must-not-miss gate"),
    appChecklistKeys: text(row, "앱 체크리스트 키"),
    appKeyChecklistIds: splitIds(row["앱키 Checklist ID"]),
    comprehensiveChecklistIds: splitIds(row["전체 Checklist ID"]),
    suspicionClues: text(row, "확률 상승/의심 단서"),
    initialEvaluation: text(row, "첫 평가/기본 검사"),
    ruleIn: text(row, "Rule-in/확진 접근"),
    ruleOut: text(row, "Rule-out/배제 접근"),
    pitfalls: text(row, "주의/함정"),
    raw: row
  }));

  const scoreItems = scoreRows.map((row) => ({
    id: text(row, "Checklist ID"),
    scoreItem: text(row, "Score/기준 항목"),
    relatedDiagnosisNames: splitList(row["관련 진단명"]),
    sourceColumn: text(row, "출처 열"),
    representativeSourceText: text(row, "대표 원문 근거"),
    status: checklistStatus(text(row, "평가값")),
    memo: text(row, "메모"),
    raw: row
  }));

  const implementationRules = implementationRows.map((row) => ({
    id: text(row, "Rule ID"),
    rule: text(row, "엔진 구현 규칙"),
    description: text(row, "설명/주의"),
    raw: row
  }));

  const disposition = dispositionRows
    .filter((row) => text(row, "위험군"))
    .map((row, index) => ({
      id: `DISP-${String(index + 1).padStart(2, "0")}`,
      riskGroup: text(row, "위험군"),
      definition: text(row, "정의 (30일 사망/MACE)"),
      entryCriteria: text(row, "진입 기준 (hs-cTn · ECG · CDP)"),
      disposition: text(row, "권고 처분"),
      additionalCardiacTesting: text(row, "추가 심장검사"),
      evidenceGrade: text(row, "근거등급(검증)"),
      sourceKey: text(row, "출처 Key"),
      raw: row
    }));

  const sources = sourceRows.map((row) => ({
    key: text(row, "Source Key") || text(row, "출처 Key") || text(row, "Key"),
    title: text(row, "Title") || text(row, "제목"),
    url: text(row, "URL") || text(row, "주요 출처 URL"),
    raw: row
  }));

  const sourceFiles = await Promise.all([
    {
      key: "workflow",
      fileName: path.basename(workflowPath),
      filePath: workflowPath,
      workbook: workflow
    },
    {
      key: "checklist",
      fileName: path.basename(checklistPath),
      filePath: checklistPath,
      workbook: checklist
    }
  ].map(async (source) => {
    const stats = await fs.stat(source.filePath);
    return {
      key: source.key,
      fileName: source.fileName,
      sizeBytes: stats.size,
      sha256: await sha256(source.filePath),
      sheets: source.workbook.SheetNames.map((sheetName) => ({
        name: sheetName,
        ...sheetUsedRows(source.workbook, sheetName),
        dataRows: Math.max(0, sheetUsedRows(source.workbook, sheetName).usedRows - 1)
      }))
    };
  }));

  const dataIntegrityReport = {
    generatedAt: new Date().toISOString(),
    sourceFiles,
    generatedCounts: {
      ddxMaster: diagnoses.length,
      appKeyChecklist: appKeyChecklist.length,
      comprehensiveChecklist: comprehensiveChecklist.length,
      ddxCoverage: ddxCoverage.length,
      mapVerbatim: mapVerbatimRows.length,
      redFlagGates: redFlagGates.length,
      scoreItems: scoreItems.length,
      implementationRules: implementationRules.length,
      disposition: disposition.length,
      sources: sources.length
    },
    expectedCounts: {
      ddxMaster: 90,
      appKeyChecklist: 262,
      comprehensiveChecklist: 1169,
      redFlagGates: redFlagGates.length,
      scoreItems: scoreItems.length
    },
    validation: {
      ddxMaster: diagnoses.length === 90,
      appKeyChecklist: appKeyChecklist.length === 262,
      comprehensiveChecklist: comprehensiveChecklist.length === 1169,
      ids: {
        appKeyUnique: new Set(appKeyChecklist.map((item) => item.id)).size === appKeyChecklist.length,
        comprehensiveUnique: new Set(comprehensiveChecklist.map((item) => item.id)).size === comprehensiveChecklist.length
      }
    }
  };

  await writeJson("ddxMaster.json", diagnoses);
  await writeJson("appKeyChecklist.json", appKeyChecklist);
  await writeJson("comprehensiveChecklist.json", comprehensiveChecklist);
  await writeJson("ddxCoverage.json", ddxCoverage);
  await writeJson("mapVerbatim.json", mapVerbatimRows);
  await writeJson("redFlagGates.json", redFlagGates);
  await writeJson("scoreItems.json", scoreItems);
  await writeJson("implementationRules.json", implementationRules);
  await writeJson("disposition.json", disposition);
  await writeJson("sources.json", sources);
  await writeJson("dataIntegrityReport.json", dataIntegrityReport);

  console.log(JSON.stringify(dataIntegrityReport.generatedCounts, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
