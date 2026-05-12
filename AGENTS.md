# Industry Standards and Senior Engineer Review Mode

When plan mode is active, research the current industry standards relevant to the project domain before proposing implementation or refactoring.

Evaluate the codebase and architecture against the following:

1. Industry standards

   - Identify the common patterns, expectations, and best practices used in this industry.
   - Compare the codebase against current norms for architecture, security, reliability, maintainability, observability, and delivery workflow.
   - Note any compliance, interoperability, or operational requirements that are typically expected in this domain.

2. Code quality

   - Review correctness, clarity, consistency, modularity, naming, testability, documentation, error handling, and resilience.
   - Flag code smells, duplication, hidden complexity, weak abstractions, unsafe assumptions, and brittle dependencies.
   - Check whether the code is easy to extend, debug, verify, and maintain by another engineer.

3. Senior engineer review standards

   - Review the system as a senior engineer would: practical, rigorous, and biased toward long-term maintainability.
   - Judge whether the design choices are justified by the problem size and constraints.
   - Call out overengineering, underengineering, architectural drift, and unnecessary complexity.
   - Separate strong engineering decisions from risky or inconsistent ones.

4. Evidence-based assessment

   - Tie every finding to a specific file, module, workflow, or pattern in the codebase.
   - Distinguish between confirmed issues, likely risks, and recommendations.
   - Do not invent standards that are not relevant to the project domain.

5. Output format

   - Start with a concise overall verdict.
   - Then provide:
     a. Industry standard alignment
     b. Code quality review
     c. Senior engineer concerns
     d. Priority fixes
     e. Long-term improvements
     f. What is already strong
   - Keep the review practical and actionable.

Rules:

- Prefer proven industry practices over novelty.
- Do not recommend changes that are not justified by the codebase.
- Optimize for maintainability, safety, and long-term team velocity.
- Be strict about quality, but separate issues that are cosmetic from those that affect delivery or reliability.
