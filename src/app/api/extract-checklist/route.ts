import { NextRequest, NextResponse } from "next/server";
import type { ChecklistItem, ChecklistProposal, ChecklistStatus } from "@/types/clinical";

type ExtractRequest = {
  freeText: string;
  currentChecklist: ChecklistItem[];
  mode?: "history" | "riskFactors" | "exam" | "testResults" | "mixed";
};

const statusValues: ChecklistStatus[] = ["unknown", "present", "absent", "not_applicable"];

const synonymRules = [
  { patterns: ["식은땀", "발한", "diaphoresis"], terms: ["diaphoresis", "식은땀", "발한"] },
  { patterns: ["팔로 방사", "좌측 팔", "턱", "등 방사", "radiation"], terms: ["radiation", "좌측 팔", "턱", "등 방사"] },
  { patterns: ["호흡곤란", "숨참", "dyspnea"], terms: ["dyspnea", "호흡곤란"] },
  { patterns: ["흉골하", "압박감", "쥐어짜"], terms: ["pressure", "압박감", "쥐어짜", "ACS risk"] },
  { patterns: ["당뇨", "dm", "흡연", "고혈압", "htn"], terms: ["ACS risk", "diabetes", "DM", "흡연", "HTN", "hypertension"] },
  { patterns: ["발열", "fever"], terms: ["발열", "fever"] },
  { patterns: ["troponin", "트로포닌"], terms: ["troponin", "hs-cTn", "cTn"] },
  { patterns: ["ecg", "심전도", "st elevation"], terms: ["ECG", "ST", "serial ECG"] }
];

function lower(value: string) {
  return value.toLowerCase();
}

function hasAny(haystack: string, needles: string[]) {
  const value = lower(haystack);
  return needles.some((needle) => value.includes(lower(needle)));
}

function itemLabel(item: ChecklistItem) {
  const raw = item.raw ?? {};
  return String(
    item.label ??
    raw["앱 체크리스트 키(원문)"] ??
    raw["체크 항목(원문 기반)"] ??
    item.id ??
    ""
  );
}

function snippet(freeText: string, patterns: string[]) {
  const normalized = lower(freeText);
  const hit = patterns.find((pattern) => normalized.includes(lower(pattern)));
  if (!hit) return freeText.slice(0, 120);
  const index = normalized.indexOf(lower(hit));
  return freeText.slice(Math.max(0, index - 32), Math.min(freeText.length, index + hit.length + 48)).trim();
}

function inferStatus(freeText: string, item: ChecklistItem): ChecklistStatus | null {
  const label = itemLabel(item);
  const itemText = label;
  if (/언급\s*없음/.test(freeText)) return null;

  if (hasAny(label, ["troponin", "hs-cTn", "cTn"]) && /troponin|트로포닌/i.test(freeText) && /pending|대기|미결|결과\s*전/i.test(freeText)) {
    return "unknown";
  }

  if (hasAny(label, ["발열", "fever"]) && /발열\s*(없|부인|음성)|no\s+fever|afebrile/i.test(freeText)) {
    return "absent";
  }

  for (const rule of synonymRules) {
    if (hasAny(freeText, rule.patterns) && hasAny(itemText, rule.terms)) {
      return "present";
    }
  }

  const labelTokens = label
    .split(/[;/,\s]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
  if (labelTokens.length > 0 && hasAny(freeText, labelTokens)) return "present";
  return null;
}

function localExtract(payload: ExtractRequest) {
  const proposals: ChecklistProposal[] = [];
  for (const item of payload.currentChecklist) {
    const proposedStatus = inferStatus(payload.freeText, item);
    if (!proposedStatus) continue;
    const evidenceText = snippet(payload.freeText, [item.label, ...synonymRules.flatMap((rule) => rule.patterns)]);
    proposals.push({
      itemId: item.id,
      itemLabel: itemLabel(item),
      proposedStatus,
      evidenceText,
      confidence: proposedStatus === "unknown" ? 0.74 : 0.82,
      action: "apply",
      memo: proposedStatus === "unknown" ? "pending 또는 미언급으로 양성/음성 처리하지 않음" : undefined
    });
  }
  const unique = new Map(proposals.map((proposal) => [proposal.itemId, proposal]));
  return [...unique.values()].slice(0, 24);
}

async function openAiExtract(payload: ExtractRequest): Promise<ChecklistProposal[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const allowedItems = payload.currentChecklist.map((item) => ({
    itemId: item.id,
    label: itemLabel(item),
    section: item.section,
    sourceText: item.sourceExample ?? item.representativeSourceText ?? ""
  }));

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You extract checklist update proposals for clinician review. Never diagnose. Never create item IDs outside the allowed list. Mentioned absence can be absent; not mentioned is unknown. Pending troponin is unknown. Return JSON: {\"proposals\":[{\"itemId\":\"...\",\"proposedStatus\":\"unknown|present|absent|not_applicable\",\"evidenceText\":\"...\",\"confidence\":0-1,\"memo\":\"...\"}],\"unparsedText\":[],\"safetyNotes\":[]}."
        },
        {
          role: "user",
          content: JSON.stringify({
            freeText: payload.freeText,
            mode: payload.mode ?? "mixed",
            allowedItems
          })
        }
      ]
    })
  });

  if (!response.ok) return null;
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;
  const parsed = JSON.parse(content) as { proposals?: Array<Partial<ChecklistProposal>> };
  const allowed = new Map(payload.currentChecklist.map((item) => [item.id, item]));
  return (parsed.proposals ?? [])
    .filter((proposal) => proposal.itemId && allowed.has(proposal.itemId))
    .filter((proposal) => proposal.proposedStatus && statusValues.includes(proposal.proposedStatus))
    .map((proposal) => {
      const item = allowed.get(proposal.itemId as string)!;
      return {
        itemId: item.id,
        itemLabel: itemLabel(item),
        proposedStatus: proposal.proposedStatus as ChecklistStatus,
        evidenceText: proposal.evidenceText ?? "",
        confidence: typeof proposal.confidence === "number" ? proposal.confidence : 0.7,
        action: "apply",
        memo: proposal.memo
      };
    });
}

export async function POST(request: NextRequest) {
  const payload = await request.json() as ExtractRequest;
  if (!payload.freeText || !Array.isArray(payload.currentChecklist)) {
    return NextResponse.json({ proposals: [], safetyNotes: ["freeText와 currentChecklist가 필요합니다."] }, { status: 400 });
  }

  const llmProposals = await openAiExtract(payload).catch(() => null);
  const proposals = llmProposals && llmProposals.length > 0 ? llmProposals : localExtract(payload);

  return NextResponse.json({
    proposals,
    unparsedText: proposals.length === 0 ? [payload.freeText] : [],
    safetyNotes: [
      "진단 확정이 아니라 기존 체크리스트 항목 반영 후보입니다.",
      "승인된 항목만 체크리스트에 반영됩니다."
    ]
  });
}
