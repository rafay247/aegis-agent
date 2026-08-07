export type EvalCase = {
  input: string;
  expected: string;
  tags: string[];
};

export const chatCases: EvalCase[] = [
  // Direct factual (6) — answerable from a single section.
  {
    input: "What are the four functions that make up the AI RMF Core?",
    expected: "The AI RMF Core is organized into four functions: GOVERN, MAP, MEASURE, and MANAGE.",
    tags: ["direct"]
  },
  {
    input: "According to the AI RMF, what does 'Reliability' mean for an AI system?",
    expected:
      "Reliability is defined (adapted from ISO/IEC TS 5723:2022) as the ability of an item to perform as required, without failure, for a given time interval, under given conditions.",
    tags: ["direct"]
  },
  {
    input: "List the seven characteristics of a trustworthy AI system as defined in the AI RMF.",
    expected:
      "Valid and Reliable; Safe; Secure and Resilient; Accountable and Transparent; Explainable and Interpretable; Privacy-Enhanced; and Fair - with Harmful Bias Managed.",
    tags: ["direct"]
  },
  {
    input: "Is the AI RMF mandatory for organizations to follow?",
    expected: "No. The AI RMF is explicitly voluntary, rights-preserving, non-sector-specific, and use-case agnostic.",
    tags: ["direct"]
  },
  {
    input: "What law directed NIST to create the AI RMF?",
    expected: "The National Artificial Intelligence Initiative Act of 2020 (P.L. 116-283).",
    tags: ["direct"]
  },
  {
    input: "What does GOVERN 1.1 require?",
    expected: "GOVERN 1.1 requires that legal and regulatory requirements involving AI are understood, managed, and documented.",
    tags: ["direct"]
  },

  // Multi-hop (5) — evidence lives in two or more sections, so a good answer
  // requires more than one retrieval pass.
  {
    input:
      "After completing the GOVERN function, which function do most users of the AI RMF start with next, and what do its first two categories or subcategories cover?",
    expected:
      "Most users start with MAP after GOVERN, before continuing to MEASURE or MANAGE. MAP 1.1 covers understanding and documenting the AI system's intended purposes, beneficial uses, context-specific laws/norms, and deployment settings; MAP 1.2 covers ensuring interdisciplinary AI actors with demographic diversity and broad domain expertise participate in establishing that context.",
    tags: ["multi-hop"]
  },
  {
    input: "How does the AI RMF define both 'Accuracy' and 'Robustness', and which trustworthiness characteristic do they fall under?",
    expected:
      "Both fall under 'Valid and Reliable'. Accuracy is defined (via ISO/IEC TS 5723:2022) as the closeness of results of observations, computations, or estimates to the true or accepted-true values. Robustness (or generalizability) is defined as the ability of a system to maintain its level of performance under a variety of circumstances, including uses not initially anticipated.",
    tags: ["multi-hop"]
  },
  {
    input: "The AI RMF says it does not prescribe risk tolerance. Which section discusses this, and what does it say organizations should do instead?",
    expected:
      "Section 1.2.2, Risk Tolerance. It says the AI RMF can be used to prioritize risk but does not prescribe risk tolerance; organizations should follow existing regulations/guidelines for risk criteria and tolerance from their sector, and where no guidelines exist, define a reasonable risk tolerance themselves before using the AI RMF to manage and document risk.",
    tags: ["multi-hop"]
  },
  {
    input: "What do GOVERN 1.2 and GOVERN 1.3 each require, and how does GOVERN 1.3 connect to risk tolerance?",
    expected:
      "GOVERN 1.2 requires that the characteristics of trustworthy AI are integrated into organizational policies, processes, procedures, and practices. GOVERN 1.3 requires that processes, procedures, and practices are in place to determine the needed level of risk management activities based on the organization's risk tolerance - directly connecting governance to the risk tolerance concept discussed in section 1.2.2.",
    tags: ["multi-hop"]
  },
  {
    input: "What is the NIST AI RMF Playbook, and how does its voluntary nature compare to the Framework's own voluntary nature?",
    expected:
      "The Playbook is an online companion resource to the AI RMF that helps organizations navigate it via suggested tactical actions. Like the Framework itself, the Playbook is voluntary - organizations can use its suggestions according to their own needs and interests, and even create their own tailored guidance from it.",
    tags: ["multi-hop"]
  },

  // Not in the document (3) — the agent should decline rather than fabricate.
  {
    input: "What is the maximum fine NIST can impose on a company that fails to comply with the AI RMF?",
    expected:
      "The AI RMF does not define any fines or enforcement penalties for non-compliance - it is an explicitly voluntary, non-regulatory framework, not a law or regulation with penalties attached.",
    tags: ["not-in-doc"]
  },
  {
    input: "What specific AI governance committee team size does the AI RMF require organizations to adopt?",
    expected:
      "The AI RMF does not specify a required governance committee team size. It explicitly leaves implementation flexible: organizations may select from among the categories and subcategories based on their own resources and capabilities rather than following a mandated structure.",
    tags: ["not-in-doc"]
  },
  {
    input: "According to the AI RMF, what is the deadline by which all US federal agencies must be fully AI RMF-compliant?",
    expected:
      "The AI RMF does not set any federal agency compliance deadline. The only related timeline in the document is NIST's own commitment to review and potentially update the Framework itself no later than 2028 - that is about updating the Framework, not agency compliance.",
    tags: ["not-in-doc"]
  }
];

export const briefCases: EvalCase[] = [
  {
    input: "Produce a structured brief on how the AI RMF defines and organizes AI risk management functions.",
    expected:
      "Should describe all four Core functions - GOVERN, MAP, MEASURE, MANAGE - with citations, and note that GOVERN is cross-cutting while most users proceed GOVERN then MAP then MEASURE/MANAGE.",
    tags: ["brief"]
  },
  {
    input: "Produce a structured brief summarizing the trustworthiness characteristics an AI system should have per the AI RMF.",
    expected:
      "Should enumerate all seven characteristics (Valid and Reliable, Safe, Secure and Resilient, Accountable and Transparent, Explainable and Interpretable, Privacy-Enhanced, Fair - with Harmful Bias Managed) with citations back to section 3.",
    tags: ["brief"]
  },
  {
    input:
      "Produce a structured brief on what the AI RMF explicitly says about its own scope and limitations - voluntary vs. mandatory, and what it does not prescribe.",
    expected:
      "Should cover: the Framework is voluntary, rights-preserving, non-sector-specific, use-case agnostic; it does not prescribe risk tolerance (section 1.2.2); and it does not prescribe profile templates.",
    tags: ["brief"]
  },
  {
    input: "Produce a structured brief comparing the GOVERN and MAP functions: their purpose and their first couple of categories.",
    expected:
      "Should contrast GOVERN's cross-cutting, culture/policy-setting role (e.g. GOVERN 1.1, 1.2) against MAP's role of establishing and understanding context (e.g. MAP 1.1, 1.2), with citations to Table 1 and Table 2 content.",
    tags: ["brief"]
  }
];
