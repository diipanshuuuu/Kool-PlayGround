export type PromptShotType = 'zero-shot' | 'one-shot' | 'few-shot';

export interface PromptShotAnalysis {
  type: PromptShotType;
  label: string;
  exampleCount: number;
  reason: string;
}

const COMPLETED_PAIR_VALUE_REGEX =
  /^\s*(?:[-*•]\s*)?(?:\*\*)?(?:output|answer|a|response|assistant|assistant response|label|sentiment|category|classification|summary|translation|result|corrected|rewritten|after|target|sql|json)(?:\*\*)?\s*:\s*(.+)$/i;

const EXAMPLE_HEADER_REGEX =
  /^\s*(?:[-*•#>]+\s*)?(?:\*\*)?(?:example|ex\.?|sample|demo|demonstration|case)(?:\s+#?\d+)?(?:\*\*)?\s*[:\-—]/i;

const ARROW_MAPPING_REGEX = /^(.+?)\s*(?:->|=>|→)\s*(.+)$/;

function countStructuredExamples(text: string): number {
  const lines = text.split(/\r?\n/);

  // 1. Count completed Output/Answer/Label/Response lines (non-empty value after ':')
  //    or Output:/Answer: lines whose value appears on the immediately following non-empty line
  let completedOutputs = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = COMPLETED_PAIR_VALUE_REGEX.exec(line);
    if (match && match[1].trim().length > 0) {
      completedOutputs += 1;
      continue;
    }
    // Check multiline output block: e.g. "Output:\nPositive" (not trailing empty "Output:")
    if (
      /^\s*(?:[-*•]\s*)?(?:\*\*)?(?:output|answer|a|response|assistant|label|sentiment|category|result)(?:\*\*)?\s*:\s*$/i.test(
        line
      )
    ) {
      const nextLine = lines[i + 1]?.trim() ?? '';
      if (
        nextLine.length > 0 &&
        !/^(?:input|question|q|prompt|user|text|before|source|example)\s*:/i.test(nextLine)
      ) {
        completedOutputs += 1;
      }
    }
  }

  // 2. Count explicit "Example 1:", "Example 2:", "Example:" headers
  let explicitHeaders = 0;
  for (const line of lines) {
    if (EXAMPLE_HEADER_REGEX.test(line)) {
      explicitHeaders += 1;
    }
  }

  // 3. Count inline arrow mapping demonstrations ("Great movie!" -> Positive)
  let arrowMappings = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('```')) continue;
    // Skip TypeScript/JS arrow functions like "(x) => {" or "const fn = () =>"
    if (/\b(?:const|let|var|function|return)\b/.test(trimmed) || /=>\s*\{/.test(trimmed)) {
      continue;
    }
    const m = ARROW_MAPPING_REGEX.exec(trimmed);
    if (m && m[1].trim().length > 0 && m[2].trim().length > 0) {
      arrowMappings += 1;
    }
  }

  // 4. Count bulleted/numbered items directly under an "Examples:" heading
  let listedExamples = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(?:#+\s*)?(?:\*\*)?(?:here are (?:some |a few )?)?examples(?:\*\*)?\s*:\s*$/i.test(lines[i])) {
      for (let j = i + 1; j < lines.length; j++) {
        const sub = lines[j].trim();
        if (!sub) {
          if (listedExamples > 0) break;
          continue;
        }
        if (/^(?:[-*•]|\d+[.)])\s+\S+/.test(sub)) {
          listedExamples += 1;
        } else {
          break;
        }
      }
    }
  }

  // 5. Detect conversational single example ("for example: ...", "here is an example: ...")
  let inlineSingleExample = 0;
  if (
    /\b(?:for example|for instance|here(?:'s| is) an example|e\.g\.)\s*[:,]?\s*["'`A-Za-z0-9]/i.test(
      text
    )
  ) {
    inlineSingleExample = 1;
  }

  return Math.max(
    completedOutputs,
    explicitHeaders,
    arrowMappings,
    listedExamples,
    inlineSingleExample
  );
}

/**
 * Classifies a user prompt (optionally combined with system instructions) as
 * zero-shot, one-shot, or few-shot based on detected in-context demonstrations.
 */
export function classifyPromptShotType(
  promptText: string,
  systemPrompt = ''
): PromptShotAnalysis | null {
  if (!promptText.trim()) {
    return null;
  }

  const combined = systemPrompt.trim()
    ? `${systemPrompt.trim()}\n\n${promptText.trim()}`
    : promptText.trim();

  const exampleCount = countStructuredExamples(combined);

  if (exampleCount === 0) {
    return {
      type: 'zero-shot',
      label: 'Zero-shot',
      exampleCount: 0,
      reason: 'Zero-shot prompt (direct instruction with no examples)',
    };
  }

  if (exampleCount === 1) {
    return {
      type: 'one-shot',
      label: 'One-shot',
      exampleCount: 1,
      reason: 'One-shot prompt (1 demonstration example detected)',
    };
  }

  return {
    type: 'few-shot',
    label: 'Few-shot',
    exampleCount,
    reason: `Few-shot prompt (${exampleCount} demonstration examples detected)`,
  };
}
