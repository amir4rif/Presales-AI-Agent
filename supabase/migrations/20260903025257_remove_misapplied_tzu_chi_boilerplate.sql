-- B23 previously merged a Tzu Chi demo template into every missing proposal
-- section, then persisted the merge on blur/back. Remove only byte-for-byte
-- matches of those known template values from non-Tzu Chi proposals. Any text
-- a user changed, and every genuine Tzu Chi proposal, remains untouched.
with boilerplate(section_key, section_value) as (
  values
    (
      'executive',
      $template$Tzu Chi Foundation requires a comprehensive volunteer management solution to streamline recruitment, deployment, communication, and reporting across its global operations.

Our proposed solution will help Tzu Chi improve volunteer coordination, increase operational efficiency, and enhance impact measurement while supporting multiple languages and regions.$template$
    ),
    (
      'challenges',
      $template$Tzu Chi faces several operational challenges:

1. Managing 10,000+ volunteers across 60+ countries with diverse languages
2. Manual volunteer coordination leading to delays in disaster response
3. Limited visibility into volunteer availability and skills inventory
4. Fragmented donor tracking and fund utilization reporting$template$
    ),
    (
      'solution',
      $template$Ramssol proposes a cloud-based Volunteer Management System (VMS) that provides:

• Centralized volunteer registry with multilingual support (20+ languages)
• AI-powered matching of volunteers to deployment needs
• Real-time coordination and communication platform
• Integrated donor management with fund tracking dashboards$template$
    ),
    (
      'benefits',
      $template$Key benefits for Tzu Chi:

• 60% reduction in volunteer coordination time
• Real-time visibility across all regional operations
• Automated compliance reporting for donors and regulators
• Mobile-first design for field volunteers$template$
    ),
    (
      'implementation',
      $template$Phase 1 (Weeks 1-4): System setup, data migration, admin training
Phase 2 (Weeks 5-8): Pilot with Taiwan and Malaysia chapters
Phase 3 (Weeks 9-12): Global rollout and optimization
Phase 4 (Month 4+): Ongoing support and enhancement$template$
    ),
    (
      'commercials',
      $template$System License: RM 180,000/year (up to 15,000 active users)
Implementation: RM 85,000 (one-time)
Training: RM 25,000
Support: RM 36,000/year (8x5 SLA)

Total Year 1: RM 326,000$template$
    ),
    (
      'casestudies',
      $template$Red Cross Malaysia — Implemented volunteer management for 5,000 volunteers. Result: 45% faster disaster response deployment.

Welfare Department Malaysia — Donor tracking system for 200,000 donors. Result: 98% fund utilization transparency.$template$
    ),
    (
      'nextsteps',
      $template$1. Schedule a technical demo (30 mins) with your IT team
2. Conduct a 2-week proof-of-concept pilot
3. Finalize commercial terms and SLA
4. Sign MOU and kick off implementation$template$
    )
)
update public.proposals as proposal
set sections = (
  select coalesce(jsonb_object_agg(section.key, section.value), '{}'::jsonb)
  from jsonb_each(proposal.sections) as section
  where not exists (
    select 1
    from boilerplate
    where boilerplate.section_key = section.key
      and to_jsonb(boilerplate.section_value) = section.value
  )
)
where proposal.company not ilike '%Tzu Chi%'
  and exists (
    select 1
    from jsonb_each(proposal.sections) as section
    join boilerplate
      on boilerplate.section_key = section.key
     and to_jsonb(boilerplate.section_value) = section.value
  );
