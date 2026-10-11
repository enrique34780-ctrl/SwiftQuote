/**
 * SwiftQuote Local AI Engine
 * Deterministic, zero-API-key planning and blueprint generation.
 *
 * This is an explainable rules/template engine, not a trained LLM. It runs
 * locally in the application process, makes no external AI calls, and must
 * never represent guesses as verified facts.
 */
const clip = (value, max = 1000) => String(value ?? '').trim().slice(0, max);
const unique = values => [...new Set(values.filter(Boolean))];

function classify(type, brief) {
  const text = (String(type || '') + ' ' + String(brief || '')).toLowerCase();
  if (/bath|shower|tile|kitchen|bathroom|renovat|remodel|room|floor|roof|plumb|electri|construction|build a house/.test(text)) return 'construction';
  if (/software|website|app |application|api|database|platform|code|deploy|security|technology/.test(text)) return 'software';
  if (/market|brand|business|company|customer|sales|service provider|subscription|revenue/.test(text)) return 'business';
  if (/product|manufactur|prototype|device|hardware/.test(text)) return 'product';
  if (/event|conference|wedding|launch party/.test(text)) return 'event';
  if (/content|video|social media|marketing|campaign|youtube/.test(text)) return 'marketing';
  if (/landscap|garden|yard|patio|fence|outdoor/.test(text)) return 'outdoor';
  return 'general';
}

const commonRisks = [
  {risk:'Requirements are incomplete or change during execution',severity:'medium',mitigation:'Write down decisions, exclusions, assumptions, and change approvals before committing time or money.',owner:'Project owner'},
  {risk:'Schedule or budget assumptions prove inaccurate',severity:'medium',mitigation:'Get current written quotes, estimate task duration, add a contingency, and review progress at each milestone.',owner:'Project owner'},
  {risk:'A dependency, supplier, or external service is unavailable',severity:'medium',mitigation:'Confirm availability directly, identify an alternative, and avoid irreversible commitments until confirmed.',owner:'Project owner'},
  {risk:'The finished work does not meet the intended result',severity:'high',mitigation:'Define acceptance criteria before work begins and test or inspect each major deliverable.',owner:'Project owner'}
];

const specialty = {
 construction: {
  name:'Site review, measurements, and safety', purpose:'Establish real conditions before design or purchase decisions.',
  tasks:[
   ['Document existing conditions','Photograph the site and record constraints, access, utilities, and items that must remain.'],
   ['Take and independently recheck measurements','Record dimensions, units, openings, slopes, and obstructions; do not estimate hidden conditions.'],
   ['Confirm permits, codes, and qualified trades','Ask the local authority and qualified professionals what approvals and licensed work apply.'],
   ['Review hazards and protection','Assess suspected lead, asbestos, mold, electrical, structural, and water risks before disturbing existing materials.']
  ]
 },
 software: {
  name:'Architecture, privacy, and security', purpose:'Design the system around explicit requirements and safe boundaries.',
  tasks:[
   ['Map user journeys and system boundaries','Document roles, permissions, data flows, failure states, and external integrations.'],
   ['Define data model and migration strategy','Use additive, reversible migrations; back up data and test migration/rollback paths.'],
   ['Threat-model authentication and sensitive actions','Check tenant isolation, CSRF, rate limits, secrets handling, input validation, and audit trails.'],
   ['Define observability and recovery','Specify health checks, useful logs, backups, alerts, rollback, and incident response.']
  ]
 },
 business: {
  name:'Customer, market, and operating model', purpose:'Test that the offer is valuable and can be delivered sustainably.',
  tasks:[
   ['Define the customer and problem','Describe the target customer, current alternative, urgency, and measurable outcome.'],
   ['Validate demand with real conversations','Interview potential customers and record objections; do not treat assumptions as evidence.'],
   ['Model pricing, costs, and unit economics','Estimate acquisition, service delivery, support, refunds, payment fees, and taxes.'],
   ['Design the customer and provider workflow','Map onboarding, service delivery, payment, support, disputes, cancellation, and retention.']
  ]
 },
 product: {
  name:'Product requirements and prototype', purpose:'Turn the idea into testable product requirements.',
  tasks:[
   ['Write product requirements and user stories','Define users, core functions, constraints, exclusions, and measurable acceptance criteria.'],
   ['Compare candidate designs and materials','Check compatibility, dimensions, safety, durability, maintainability, and sourcing.'],
   ['Build or mock up a small prototype','Test the riskiest assumptions with the least expensive reversible experiment.'],
   ['Plan quality, compliance, and production','Identify required testing, certifications, supplier checks, packaging, and serviceability.']
  ]
 },
 event: {
  name:'Event plan and logistics', purpose:'Coordinate people, timing, suppliers, and contingencies.',
  tasks:[
   ['Define audience, goals, and capacity','Set expected attendance, success measures, accessibility needs, and constraints.'],
   ['Confirm venue, permissions, and suppliers','Get written availability, terms, cancellation policies, and any applicable approvals.'],
   ['Create run of show and responsibility map','Assign owners, timings, contact methods, setup, teardown, and escalation paths.'],
   ['Prepare contingency and attendee communications','Plan for weather, cancellations, accessibility issues, and emergency response.']
  ]
 },
 marketing: {
  name:'Audience, message, and content plan', purpose:'Connect a specific audience to a measurable action.',
  tasks:[
   ['Define audience and conversion goal','Choose a target segment and one primary measurable action.'],
   ['Develop message and proof points','Separate substantiated claims from assumptions and avoid unsupported guarantees.'],
   ['Create content calendar and assets','Specify channel, format, owner, deadline, review, and reuse rights.'],
   ['Instrument results and run small tests','Track baseline metrics, test one variable at a time, and document learning.']
  ]
 },
 outdoor: {
  name:'Site, environment, and layout', purpose:'Check site conditions and constraints before installation.',
  tasks:[
   ['Survey boundaries, grade, and drainage','Verify property boundaries, slope, runoff, access, and existing utilities.'],
   ['Check local approvals and utility locations','Confirm permits, easements, setbacks, and utility marking before digging.'],
   ['Select climate-appropriate materials and plants','Verify local suitability, maintenance needs, mature size, and supplier availability.'],
   ['Plan installation and maintenance','Sequence work and define watering, drainage, inspection, and seasonal upkeep.']
  ]
 },
 general: {
  name:'Discovery and requirements', purpose:'Convert the initial idea into an agreed, testable scope.',
  tasks:[
   ['Define the intended outcome','Write what success means, who benefits, and how the result will be measured.'],
   ['Document constraints and non-goals','Record budget, timing, resources, accessibility, dependencies, and what is excluded.'],
   ['Research unknowns with reliable sources','List questions that need external confirmation and record the source/date of each answer.'],
   ['Compare options before committing','Evaluate at least two feasible approaches by cost, risk, time, quality, and reversibility.']
  ]
 }
};

function task(title, description, depends_on = [], effort = 'To estimate') {
  return { title, description, depends_on, effort, status:'todo' };
}

export function buildLocalProjectPlan(input = {}) {
  const title = clip(input.title, 120) || 'Untitled project';
  const type = clip(input.type, 80) || 'Other';
  const brief = clip(input.brief, 5000);
  const constraints = clip(input.constraints, 1600);
  const timeline = clip(input.timeline, 160);
  const budget = clip(input.budget, 160);
  const category = classify(type, brief);
  const focus = specialty[category];
  const first = {
    name:'1. Define and verify the brief',
    purpose:'Agree on what is being built, why, and how success will be checked.',
    tasks:[
      task('Turn the goal into measurable outcomes', 'Write 3–5 observable success criteria based on the requested result.'),
      task('Separate known facts from assumptions', 'Mark every unverified measurement, price, date, capability, or external dependency as an open item.'),
      task('Confirm scope, exclusions, budget, and timing', 'Agree on what is included, what is not, available resources, and who approves changes.')
    ]
  };
  const second = {
    name:'2. '+focus.name,
    purpose:focus.purpose,
    tasks:focus.tasks.map((t,i)=>task(t[0],t[1],i? [focus.tasks[i-1][0]]: ['Turn the goal into measurable outcomes']))
  };
  const third = {
    name:'3. Build and coordinate',
    purpose:'Execute in small, reviewable steps with clear owners and dependencies.',
    tasks:[
      task('Break the work into small deliverables','Give each deliverable an owner, input, expected output, and acceptance criteria.',['Confirm scope, exclusions, budget, and timing']),
      task('Confirm resources and dependencies before use','Verify current supplier, tool, team, access, and schedule availability.',['Break the work into small deliverables']),
      task('Complete a small end-to-end pilot','Test the highest-risk part before expanding the scope.',['Confirm resources and dependencies before use']),
      task('Record decisions and changes','Keep a decision log and require approval for changes that affect budget, safety, or scope.',['Complete a small end-to-end pilot'])
    ]
  };
  const fourth = {
    name:'4. Verify, launch, and improve',
    purpose:'Prove that the result meets the agreed criteria and can be maintained.',
    tasks:[
      task('Run acceptance checks against the original goals','Use a written checklist and record pass, fail, and unresolved items.',['Complete a small end-to-end pilot']),
      task('Review safety, privacy, compliance, and quality','Use qualified independent review wherever work is regulated or safety-critical.',['Run acceptance checks against the original goals']),
      task('Prepare handover, backup, and rollback','Document operation, maintenance, support, recovery, and ownership.',['Review safety, privacy, compliance, and quality']),
      task('Review outcomes and prioritize improvements','Compare actual outcomes with success criteria and rank the next changes.',['Prepare handover, backup, and rollback'])
    ]
  };
  const assumptions = [
    'The supplied description is the source of project intent; it has not been independently verified.',
    'No external websites, supplier inventory, live prices, permits, or site conditions were checked by this local engine.',
    'Task durations and costs require estimates from the people doing the work.'
  ];
  if (constraints) assumptions.push('User-supplied constraints to confirm at kickoff: '+constraints.slice(0,350));
  const questions = [
    'Who is the final decision-maker and who will use the result?',
    'What are the non-negotiable acceptance criteria and exclusions?',
    'Which facts, measurements, permissions, and prices must be independently confirmed?'
  ];
  if (!budget) questions.push('What budget range and contingency are available?');
  if (!timeline) questions.push('What is the target date and which milestones are fixed?');
  const risks = commonRisks.map(r=>({...r}));
  if (category === 'construction') risks.unshift({risk:'Incorrect measurements, hidden conditions, or unapproved safety-critical work',severity:'critical',mitigation:'Verify dimensions on site, check local permit requirements, and obtain qualified professional review for structural, electrical, plumbing, gas, waterproofing, and other regulated work.',owner:'Qualified professional / owner'});
  if (category === 'software') risks.unshift({risk:'Unauthorized access, data loss, or unsafe production changes',severity:'high',mitigation:'Test access controls, keep backups, review secrets and tenant boundaries, and require human approval plus rollback before production changes.',owner:'Technical owner'});
  const budgetGuidance = budget
    ? 'User-provided budget: '+budget+'. This engine has not checked market prices or confirmed that the scope fits this budget. Obtain current written quotes and reserve contingency.'
    : 'Budget was not supplied. Obtain current written quotes or effort estimates, include operating/support costs, and set a contingency before commitments.';
  return {
    title, project_type:type,
    executive_summary:'A structured, locally generated first-pass plan for “'+title+'”. It converts the supplied brief into staged work, dependencies, risks, and checks; it is a planning aid, not evidence that work has been performed.',
    goal:brief,
    scope_included:['Clarify requirements and success criteria','Plan the relevant specialist work','Coordinate resources, dependencies, and decisions','Verify the finished result against acceptance criteria'],
    scope_excluded:['Unverified live prices, supplier stock, or external facts','Professional certification, legal advice, or permit approval','Automatic purchases, hiring, account changes, deployment, or real-world execution'],
    assumptions,
    open_questions:questions,
    workstreams:[first,second,third,fourth],
    milestones:[
      {name:'M1 — Brief approved',acceptance_criteria:['Goal and audience are explicit','Scope and exclusions are recorded','Budget and schedule assumptions are visible'],depends_on:[]},
      {name:'M2 — Feasibility and risks reviewed',acceptance_criteria:['Critical unknowns have an owner','Required approvals and dependencies are identified','High-risk decisions have a review path'],depends_on:['M1 — Brief approved']},
      {name:'M3 — Pilot or first deliverable accepted',acceptance_criteria:['A small end-to-end result exists','Acceptance checks are recorded','Material defects have an owner'],depends_on:['M2 — Feasibility and risks reviewed']},
      {name:'M4 — Handover and next steps approved',acceptance_criteria:['Final checklist is complete or open issues are disclosed','Ownership and maintenance are assigned','Recovery or contingency steps are documented'],depends_on:['M3 — Pilot or first deliverable accepted']}
    ],
    risks,
    deliverables:[
      {name:'Project brief and decision log',acceptance_criteria:['Goal, scope, exclusions, constraints, and approver are documented']},
      {name:'Execution plan and milestone checklist',acceptance_criteria:['Tasks have clear outputs and dependencies','Critical unknowns have owners']},
      {name:'Verification and handover pack',acceptance_criteria:['Acceptance results and open issues are recorded','Maintenance and recovery responsibilities are clear']}
    ],
    resources:unique(['Project owner / decision-maker','People with the relevant subject-matter expertise','Current written supplier or service quotes','A shared task and decision log', category==='construction'?'Qualified trades and local permitting authority':category==='software'?'Test environment, source control, and monitoring':'A small pilot group or test audience']),
    budget_guidance:budgetGuidance,
    verification_plan:[
      'Check every deliverable against a written acceptance criterion.',
      'Independently verify measurements, prices, availability, dates, and claims using current primary sources.',
      'Use a second reviewer for high-impact or safety-critical decisions.',
      'Test failure cases and document unresolved issues before calling the work complete.',
      'Record who approved launch and how to recover if the result fails.'
    ],
    next_actions:[
      'Review and correct this draft so it matches the real project.',
      'Answer the open questions and assign an owner to every critical unknown.',
      'Choose the smallest useful pilot and define its pass/fail criteria.',
      'Confirm costs, schedule, approvals, and safety requirements before making commitments.'
    ],
    status:'local_rule_engine_draft',
    safety_note:'Generated by SwiftQuote Local AI Engine (rules and templates; no external model was called). This is not a guarantee of correctness. Verify all project-specific facts and obtain qualified review where needed.'
  };
}

export function buildLocalBlueprint(input = {}) {
  const title=clip(input.title,120)||'Untitled project';
  const type=clip(input.type,80)||'Other';
  const brief=clip(input.brief,4000);
  const budget=clip(input.budget,100);
  const dimensions=clip(input.dimensions,1200);
  const style=clip(input.style,300);
  const category=classify(type,brief);
  const construction=category==='construction'||/construction|renovation|remodel/i.test(type);
  const phases=[
    {name:'1. Discovery and existing conditions',tasks:[
      'Record the goal, existing conditions, constraints, and items that must remain.',
      'Measure relevant dimensions and independently recheck them before ordering materials.',
      'List unknown conditions and assign someone to verify each one.'
    ]},
    {name:'2. Options and design decisions',tasks:[
      'Compare feasible design or implementation options by cost, time, maintenance, accessibility, and risk.',
      'Check product or component dimensions, compatibility, installation requirements, warranties, and returns.',
      'Record the selected option, alternatives rejected, and the reason for the decision.'
    ]},
    {name:'3. Budget, approvals, and execution prep',tasks:[
      'Obtain current written quotes and confirm supplier availability directly.',
      'Confirm applicable permits, inspections, insurance, licenses, and approval requirements with relevant authorities.',
      'Sequence work by dependency, name an owner for each task, and include contingency.'
    ]},
    {name:'4. Implementation and quality checks',tasks:[
      'Follow current manufacturer instructions, approved plans, and applicable professional requirements.',
      'Inspect or test each stage against acceptance criteria before moving to dependent work.',
      'Keep receipts, versions, warranties, decisions, completion evidence, and unresolved issues.'
    ]}
  ];
  const safety=construction?[
    'Confirm permit and inspection requirements with the local authority; requirements vary by location and scope.',
    'Use qualified professionals for structural, electrical, plumbing, gas, waterproofing, and other regulated or safety-critical work.',
    'Before demolition or drilling, assess utilities and suspected lead, asbestos, mold, or other hazardous materials.',
    'Confirm waterproofing, drainage, ventilation, accessibility, and manufacturer installation details as applicable.'
  ]:[
    'Identify privacy, security, safety, accessibility, and compliance requirements before implementation.',
    'Use qualified independent review for regulated, safety-critical, or high-impact decisions.',
    'Confirm dependencies and external facts rather than treating assumptions as verified.'
  ];
  return {
    title,project_type:type,overview:brief,
    design_goals:style?[style]:['Meet the stated goal','Respect the supplied constraints','Prioritize safety, maintainability, and verifiable quality'],
    assumptions:[
      'This draft is based only on the information supplied in the form.',
      'No site inspection, live inventory lookup, local code lookup, or price verification was performed.',
      dimensions?'Supplied dimensions or constraints need to be checked against actual conditions.':'Exact dimensions and existing conditions still need to be confirmed.'
    ],
    phases,
    materials:[],
    measurements_to_confirm:[dimensions||'Record exact dimensions, units, openings, access, utilities, and existing conditions before selecting quantities.','Confirm quantities and compatibility with the chosen product specifications.'],
    safety_and_permit_checks:safety,
    budget_notes:budget?'User-stated budget: '+budget+'. Current prices and project fit have not been verified; obtain written quotes and add contingency.':'Budget not provided; collect current written quotes and include contingency, delivery, disposal, taxes, and ongoing costs where applicable.',
    professional_review:construction?['Have a qualified professional review structural, electrical, plumbing, gas, waterproofing, and other safety-critical details as applicable.','Confirm applicable permits and inspections with the local authority.']:['Ask a qualified reviewer to assess regulated or high-impact parts of the plan.','Review all assumptions and acceptance criteria before committing resources.'],
    status:'local_rule_engine_draft',
    verification_note:'Generated locally by rules and templates; no OpenAI/Gemini API was called. This is an editable planning draft, not a stamped drawing, inspected site plan, verified quote, or guarantee.'
  };
}


/**
 * Deterministic quality gates for local plans.
 * Reports issues and recommendations; never claims semantic correctness.
 */
export function validateLocalPlan(plan = {}) {
  const errors = [];
  const warnings = [];
  const recommendations = [];
  const add = (bucket, code, message, path = '') => bucket.push({ code, message, path });
  const text = value => String(value ?? '').trim();
  const arr = value => Array.isArray(value) ? value : [];
  const normalize = value => text(value).toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const workstreams = arr(plan.workstreams);
  const milestones = arr(plan.milestones);
  const risks = arr(plan.risks);
  const deliverables = arr(plan.deliverables);
  const tasks = [];
  const taskNames = new Map();

  if (!text(plan.title)) add(errors, 'missing-title', 'Add a project title.', 'title');
  if (!text(plan.goal)) add(errors, 'missing-goal', 'Describe the intended outcome.', 'goal');
  if (!workstreams.length) add(errors, 'missing-workstreams', 'Add at least one workstream with actionable tasks.', 'workstreams');
  if (!milestones.length) add(warnings, 'missing-milestones', 'Add milestones so progress can be reviewed.', 'milestones');
  if (!arr(plan.open_questions).length) add(warnings, 'no-open-questions', 'Confirm that missing requirements were considered.', 'open_questions');
  if (!arr(plan.assumptions).length) add(warnings, 'no-assumptions', 'List assumptions and facts that have not been verified.', 'assumptions');
  if (!arr(plan.verification_plan).length) add(errors, 'missing-verification', 'Add a verification plan before treating the project as ready.', 'verification_plan');
  if (!risks.length) add(warnings, 'missing-risks', 'Add project-specific risks and mitigations.', 'risks');
  if (!deliverables.length) add(warnings, 'missing-deliverables', 'Define outputs and acceptance criteria.', 'deliverables');

  workstreams.forEach((stream, wi) => {
    if (!text(stream?.name)) add(errors, 'missing-workstream-name', 'Name this workstream.', `workstreams[${wi}].name`);
    const streamTasks = arr(stream?.tasks);
    if (!streamTasks.length) add(warnings, 'empty-workstream', 'This workstream has no tasks.', `workstreams[${wi}].tasks`);
    streamTasks.forEach((taskItem, ti) => {
      const path = `workstreams[${wi}].tasks[${ti}]`;
      const name = text(taskItem?.title);
      if (!name) add(errors, 'missing-task-title', 'Give each task a title.', path + '.title');
      if (!text(taskItem?.description)) add(warnings, 'missing-task-detail', 'Add an actionable description and expected result.', path + '.description');
      const key = normalize(name);
      if (key) {
        if (taskNames.has(key)) add(errors, 'duplicate-task', 'Task title duplicates another task; use unique names so dependencies are unambiguous.', path + '.title');
        else taskNames.set(key, path);
      }
      tasks.push({ item: taskItem, path, key, deps: arr(taskItem?.depends_on).map(normalize).filter(Boolean) });
    });
  });

  const graph = new Map(tasks.map(t => [t.key, t.deps]));
  tasks.forEach(t => t.deps.forEach(dep => {
    if (!graph.has(dep)) add(errors, 'unknown-task-dependency', `Dependency “${dep}” does not match any task title.`, t.path + '.depends_on');
    if (dep === t.key) add(errors, 'self-dependency', 'A task cannot depend on itself.', t.path + '.depends_on');
  }));
  const visiting = new Set(), visited = new Set();
  function visit(key, chain = []) {
    if (visiting.has(key)) {
      add(errors, 'dependency-cycle', 'Circular task dependencies detected: ' + [...chain, key].join(' → '), 'workstreams');
      return;
    }
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dep of graph.get(key) || []) if (graph.has(dep)) visit(dep, [...chain, key]);
    visiting.delete(key); visited.add(key);
  }
  for (const key of graph.keys()) visit(key);

  const milestoneNames = new Set();
  milestones.forEach((m, i) => {
    const key = normalize(m?.name);
    if (!key) add(errors, 'missing-milestone-name', 'Name each milestone.', `milestones[${i}].name`);
    if (key && milestoneNames.has(key)) add(errors, 'duplicate-milestone', 'Milestone names should be unique.', `milestones[${i}].name`);
    milestoneNames.add(key);
    if (!arr(m?.acceptance_criteria).length) add(warnings, 'milestone-no-criteria', 'Add observable pass/fail acceptance criteria.', `milestones[${i}].acceptance_criteria`);
    arr(m?.depends_on).forEach((dep, j) => {
      if (!milestoneNames.has(normalize(dep)) && !milestones.some(other => normalize(other?.name) === normalize(dep))) {
        add(warnings, 'unknown-milestone-dependency', 'Check that this milestone dependency exists.', `milestones[${i}].depends_on[${j}]`);
      }
    });
  });
  risks.forEach((risk, i) => {
    if (!text(risk?.risk)) add(warnings, 'unnamed-risk', 'Describe the risk.', `risks[${i}].risk`);
    if (!text(risk?.mitigation)) add(warnings, 'risk-no-mitigation', 'Add a practical mitigation and owner.', `risks[${i}].mitigation`);
    if (!['low','medium','high','critical'].includes(text(risk?.severity).toLowerCase())) add(warnings, 'risk-severity', 'Choose low, medium, high, or critical severity.', `risks[${i}].severity`);
  });
  deliverables.forEach((d, i) => {
    if (!text(d?.name)) add(warnings, 'unnamed-deliverable', 'Name the deliverable.', `deliverables[${i}].name`);
    if (!arr(d?.acceptance_criteria).length) add(warnings, 'deliverable-no-criteria', 'Add a way to verify this deliverable.', `deliverables[${i}].acceptance_criteria`);
  });

  const allText = JSON.stringify(plan).toLowerCase();
  const hazardous = [
    [/\bguaranteed?\s+(?:correct|safe|error[- ]free|perfect)\b|\bzero\s+(?:bugs|mistakes|errors)\b/, 'unsupported-guarantee', 'Remove guarantees of perfection or error-free results; report what was actually checked.'],
    [/\b(?:live|current)\s+(?:inventory|stock|prices?)\s+(?:verified|confirmed)\b/, 'unverified-live-claim', 'Only claim live prices or inventory when a trusted current source was actually queried.'],
    [/\b(?:permit|code)\s+(?:approved|compliant|confirmed)\b/, 'unverified-compliance-claim', 'Have applicable permits and codes confirmed by the relevant authority or qualified professional.']
  ];
  for (const [pattern, code, message] of hazardous) if (pattern.test(allText)) add(errors, code, message, 'plan');

  if (!text(plan.budget_guidance) && !text(plan.budget_notes)) add(warnings, 'no-budget-guidance', 'State that a budget is missing or identify which user-provided budget still needs quotes.', 'budget_guidance');
  if (!text(plan.safety_note) && !text(plan.verification_note)) add(warnings, 'no-verification-disclaimer', 'Explain that this is a draft and identify facts that still need independent verification.', 'safety_note');
  if (errors.length) recommendations.push('Fix all errors before treating this plan as ready to execute.');
  if (warnings.length) recommendations.push('Review warnings with the project owner; some may be acceptable if explicitly acknowledged.');
  recommendations.push('Re-run checks after editing. These deterministic checks detect common structural issues, not every factual, legal, safety, or reasoning error.');
  const deductions = errors.length * 15 + warnings.length * 4;
  const score = Math.max(0, Math.min(100, 100 - deductions));
  return {
    engine: 'swiftquote-local-verifier',
    checked_at: new Date().toISOString(),
    score,
    status: errors.length ? 'needs_changes' : warnings.length ? 'review_recommended' : 'structurally_consistent',
    counts: { errors: errors.length, warnings: warnings.length, tasks: tasks.length, milestones: milestones.length, risks: risks.length, deliverables: deliverables.length },
    errors, warnings, recommendations,
    limitations: 'A high score is not a correctness guarantee. This verifier checks structure, references, duplicates, dependency cycles, and explicit risk/verification fields; it does not independently verify external facts or prove that a plan is safe or feasible.'
  };
}

export function analyzeLocalRequirements(input = {}) {
  const brief = clip(input.brief, 5000);
  const constraints = clip(input.constraints, 1600);
  const combined = (brief + ' ' + constraints).toLowerCase();
  const gaps = [];
  const add = (id, label, why, severity = 'medium') => gaps.push({ id, label, why, severity });
  if (!/\b(?:for|customer|user|audience|team|family|tenant|provider|client)\b/i.test(brief)) add('audience', 'Identify who the result is for', 'The intended users affect scope, usability, and acceptance criteria.');
  if (!/\b(?:must|need to|requirement|acceptance|success|done means|pass criteria)\b/i.test(combined)) add('acceptance', 'Define measurable acceptance criteria', 'Without pass/fail criteria, completion is subjective.');
  if (!/\b(?:budget|\$\s*\d|usd|cost limit|price range|no budget)\b/i.test(combined)) add('budget', 'Set a budget or explicitly mark it unknown', 'Cost feasibility cannot be evaluated without a budget or a decision to defer it.');
  if (!/\b(?:deadline|timeline|by [a-z]+|weeks?|months?|days?|flexible date)\b/i.test(combined)) add('timeline', 'Set a target timeline or mark it flexible', 'Timing affects sequencing and availability.');
  if (!/\b(?:constraint|must not|cannot|existing|accessibility|security|privacy|permit|approval|compatib|dependenc)\b/i.test(combined)) add('constraints', 'List important constraints and dependencies', 'Hidden constraints commonly cause rework.');
  if (!/\b(?:test|verify|inspect|review|validate|measure|proof)\b/i.test(combined)) add('verification', 'Decide how the result will be tested or inspected', 'A plan needs an objective way to verify the result.');
  const highRisk = /\b(?:structural|load[- ]bearing|electrical|wiring|gas line|plumbing|waterproof|asbestos|lead paint|mold|medical|healthcare|payment processing|authentication|personal data|production deploy|financial advice)\b/i.test(combined);
  if (highRisk) add('expert-review', 'Arrange qualified review for safety, security, or regulated work', 'The brief mentions a potentially high-impact area that should not rely on an automated draft alone.', 'high');
  return {
    engine: 'swiftquote-local-requirements',
    brief_characters: brief.length,
    gaps,
    suggested_questions: gaps.map(g => g.label + ': ' + g.why),
    note: 'Keyword-based gap detection is a prompt for discussion, not proof that a requirement is present or absent.'
  };
}


/**
 * Build a deterministic test/inspection matrix from a project brief.
 * Test steps are proposals; a human must perform them and record evidence.
 */
export function buildLocalTestMatrix(input = {}) {
  const title = clip(input.title, 120) || 'Untitled project';
  const type = clip(input.type, 80) || 'Other';
  const brief = clip(input.brief, 5000);
  const category = classify(type, brief);
  const cases = [];
  const add = (area, name, steps, expected, priority = 'medium', reviewer = 'Project owner') => {
    cases.push({
      id: 'SQ-T' + String(cases.length + 1).padStart(3, '0'),
      area, name, steps, expected, priority, reviewer,
      status: 'not_run',
      evidence: '',
      notes: ''
    });
  };
  add('Requirements', 'Trace requirements to acceptance checks',
    'List each stated requirement and link it to at least one test, inspection, or explicit reason it cannot be verified yet.',
    'Every important requirement has a measurable pass/fail check or an owner for the unresolved check.', 'high');
  add('Scope', 'Check exclusions and assumptions',
    'Review assumptions, exclusions, dependencies, and unresolved questions with the decision-maker.',
    'No critical assumption is silently treated as a confirmed fact.', 'high');
  add('Quality', 'Check failure and recovery paths',
    'Identify likely failure cases; rehearse the safe response, recovery owner, and communication path.',
    'Failures are detected, recorded, and handled without unsafe or irreversible surprise actions.', 'high');
  add('Handover', 'Confirm ownership and maintenance',
    'Ask the intended operator to follow the handover instructions without help from the author.',
    'The operator can complete core tasks and knows how to get help or recover from common failures.', 'medium');

  if (category === 'software') {
    add('Security', 'Reject unauthenticated protected actions',
      'Call each protected endpoint without a valid session, then repeat with a valid session and invalid CSRF token.',
      'Unauthenticated or forged state-changing requests are rejected; legitimate authorized requests work.', 'critical', 'Security reviewer');
    add('Authorization', 'Check account and tenant isolation',
      'Create two test accounts; attempt to read, update, and delete each other’s records using guessed identifiers.',
      'Every cross-account operation is denied without leaking record contents.', 'critical', 'Security reviewer');
    add('Input validation', 'Exercise invalid and oversized input',
      'Submit empty values, wrong types, unexpected fields, boundary-length values, malformed JSON, and oversized payloads.',
      'Invalid requests fail safely with clear errors; the process remains healthy and data stays consistent.', 'high');
    add('Reliability', 'Test dependency outage and timeout',
      'Simulate unavailable external services, database failures in a test environment, and slow responses.',
      'Errors are handled, timeouts are bounded, sensitive details are not exposed, and retries do not duplicate actions.', 'high');
    add('Data safety', 'Test backup and restore procedure',
      'Back up a disposable test database, change test data, restore it, and compare record counts and key relationships.',
      'The documented restore procedure recovers expected data and its integrity is checked.', 'critical', 'Technical owner');
    add('Release', 'Test migration and rollback',
      'Run the migration on a copy of representative data, exercise the application, and test the documented recovery plan.',
      'Existing records remain readable; failures and rollback behavior are documented before production use.', 'high');
    add('Accessibility', 'Check keyboard and screen-reader basics',
      'Navigate primary workflows with keyboard only; inspect labels, focus order, status messages, contrast, and zoom.',
      'Primary tasks remain operable without a mouse and controls have meaningful labels and focus states.', 'medium');
  } else if (category === 'construction') {
    add('Measurements', 'Recheck critical dimensions on site',
      'Measure the site using consistent units; independently repeat critical measurements and record obstructions/openings.',
      'A second check agrees within the required project tolerance before materials are ordered.', 'critical', 'Qualified installer / owner');
    add('Compatibility', 'Verify selected products fit and are compatible',
      'Compare actual measurements with manufacturer specifications, installation clearances, substrate needs, and required accessories.',
      'Selected products fit the verified conditions and their installation requirements are understood.', 'high', 'Qualified installer');
    add('Safety and approvals', 'Confirm applicable permits and qualified review',
      'Ask the relevant local authority and qualified trades which approvals, inspections, and licensed work apply.',
      'Requirements are confirmed by appropriate sources; no automated plan is treated as approval.', 'critical', 'Owner / qualified professional');
    add('Quality', 'Inspect work before it is concealed',
      'Define stage-by-stage inspection points and document work before walls, floors, or other access is closed.',
      'Critical work is inspected or tested and evidence is retained before proceeding.', 'critical', 'Qualified inspector / installer');
    add('Water and structure', 'Check relevant water, drainage, and structural details',
      'Where applicable, obtain qualified review of waterproofing, drainage, ventilation, load paths, and existing damage.',
      'Applicable safety-critical details have qualified sign-off and unresolved issues are not covered up.', 'critical', 'Qualified professional');
  } else if (category === 'business') {
    add('Customer journey', 'Test onboarding through successful completion',
      'Walk through a new customer and provider account using test data, including an incomplete profile and a failed step.',
      'Users understand the next step and can recover from validation errors.', 'high');
    add('Money', 'Reconcile pricing, fees, refunds, and cancellation',
      'Use test transactions or a spreadsheet to reconcile the advertised price, fees, tax assumptions, refund rules, and cancellation path.',
      'The customer-facing terms and the internal records agree; no live payment is made during a test.', 'critical', 'Business owner');
    add('Operations', 'Test disputes and support escalation',
      'Simulate a missed appointment, quality complaint, cancellation, and provider unavailability.',
      'Each scenario has an owner, documented response, and customer communication path.', 'high');
    add('Market validation', 'Test the offer with real target users',
      'Interview a small sample of intended customers; record actual objections and whether they take a meaningful next step.',
      'Demand claims are based on observed evidence rather than assumptions alone.', 'medium');
  } else if (category === 'product') {
    add('Functionality', 'Test core use cases and edge conditions',
      'Write representative normal, boundary, misuse, and failure scenarios and perform them on a prototype.',
      'Results meet the product requirements or gaps are logged with owners.', 'high');
    add('Safety and compliance', 'Check hazards and applicable requirements',
      'Identify foreseeable misuse, material hazards, required standards, and any needed independent testing.',
      'Applicable safety and certification requirements are assigned to qualified reviewers before release.', 'critical', 'Qualified reviewer');
    add('Durability', 'Check wear, maintenance, and serviceability',
      'Define realistic use cycles, inspection criteria, maintenance steps, and replaceable parts where applicable.',
      'Known maintenance needs and failure limits are documented and supported by evidence.', 'high');
  } else if (category === 'event') {
    add('Logistics', 'Rehearse arrival-to-close timeline',
      'Walk the venue and schedule from setup through teardown; verify owners, access, contacts, and transition timing.',
      'Every critical time slot and handoff has an accountable owner.', 'high');
    add('Safety', 'Review emergency and accessibility plans',
      'Confirm venue rules, accessible routes, crowd capacity, emergency contacts, and contingency arrangements with responsible parties.',
      'Plans are reviewed by the relevant venue or safety leads; attendees can access needed information.', 'critical');
    add('Contingency', 'Run a cancellation or disruption scenario',
      'Simulate a supplier cancellation, severe weather, or a key staff absence and follow the fallback plan.',
      'A workable alternative and communication owner are identified.', 'high');
  } else if (category === 'marketing') {
    add('Claims', 'Verify factual claims and permissions',
      'Trace each product, performance, testimonial, and comparison claim to supporting evidence and usage permissions.',
      'Unsupported claims are removed and media rights are documented.', 'high');
    add('Measurement', 'Check tracking and conversion path',
      'Perform a test journey from content view through the intended action and verify analytics events using test data.',
      'Key events are recorded once with the intended attribution and privacy controls.', 'medium');
    add('Experiment', 'Review test design before publishing',
      'Record baseline, hypothesis, primary metric, duration, and the one variable being changed.',
      'Results can be interpreted without overstating causation.', 'medium');
  } else if (category === 'outdoor') {
    add('Site', 'Verify boundaries, slope, drainage, and utilities',
      'Confirm property boundaries and drainage conditions and use the appropriate utility-location process before digging.',
      'The work area and relevant constraints are verified before ground disturbance.', 'critical', 'Owner / qualified professional');
    add('Environment', 'Check local suitability and maintenance',
      'Confirm local climate, mature plant size, water needs, material durability, and seasonal maintenance.',
      'Selections suit the site and maintenance responsibilities are clear.', 'medium');
  }

  return {
    title: title + ' — Verification checklist',
    project_type: type,
    engine: 'swiftquote-local-test-matrix',
    generated_at: new Date().toISOString(),
    status: 'proposed_not_run',
    summary: 'A locally generated test and inspection proposal for “' + title + '”. None of these checks have been performed by generating this checklist.',
    cases,
    execution_rules: [
      'Run checks in a safe test environment where possible; do not use live payments or production data for experiments.',
      'For each case, record pass, fail, blocked, or not run, plus evidence and the person who performed it.',
      'A failed critical check blocks release until it is fixed or formally accepted by the accountable owner.',
      'Retest affected cases after a change and run regression checks before release.',
      'Use qualified professionals for regulated or safety-critical inspections.'
    ],
    exit_criteria: [
      'All critical cases have a recorded result and evidence.',
      'No unresolved critical failure remains without explicit, documented risk acceptance.',
      'Open issues have owners and target dates.',
      'The responsible owner reviews and signs off on the results.'
    ],
    limitation: 'This is a rules-based checklist, not an execution engine. It does not run code, inspect a physical site, verify live facts, or prove safety. A human or connected test system must perform the checks and record evidence.'
  };
}
