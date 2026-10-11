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
