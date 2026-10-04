# Clear review text

Apply these principles to PR summaries and workspace text. They adapt [ASD-STE100 Issue 9](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf) for software review. Do not claim STE compliance or a measured “80% STE” score.

- Use short active sentences. Identify the component that performs the action.
- Give one idea per sentence. Target at most 25 words for descriptions and 20 for instructions.
- Use the same name for the same component throughout the diagram, spec, and summary.
- Keep established software terms and exact API names. Do not substitute vague words to make text shorter.
- Prefer a verb and an object for connection labels. Target three to eight words when the contract permits it.
- Explain the condition before the action when the condition matters.
- Preserve technical meaning. Split a long sentence instead of removing a failure condition, state change, or compatibility constraint.
- Introduce information gradually: behavior change, complete flow, engineering decisions, verification, and unresolved risks.

## Shared terms

| Term | Meaning in a review |
| --- | --- |
| Component | A named owner of behavior or state. |
| Contract | The operation or data that crosses a component boundary. |
| Scenario | One recorded path from a trigger to an outcome. |
| Step | One ordered interaction in a scenario. |
| Before | The behavior recorded before the change. |
| Intended | The behavior the change must provide. |
| Observed | The implementation the author inspected. |
| Evidence | A source inspection or test that supports a recorded claim. |

Use a component's actual name instead of “handler,” “adapter,” or “service” interchangeably. A project may define more technical terms as needed.

## Examples

“Compare proposed edits with the saved baseline” → “Compare edits with the baseline.”

“The rejection of requests lacking authentication is performed by the workspace server” → “The workspace server rejects requests without a session token.”

“The delegation contract is validated and persisted before a response is returned” → “The server validates the delegation contract. It saves the contract before it returns a response.”

These are style examples. Use them only when they match inspected behavior.

## Evaluation

`validate` and the workspace source report include advisory `writingWarnings`. The checker measures sentence length. It does not verify dictionary approval, active voice, consistent terminology, or factual accuracy.

Use an LLM judge to check clarity, preserved meaning, complete flow, and honest evidence. Record the cases, expected facts, actual results, and evaluation limits. An author self-assessment is not independent evaluation. Human comprehension requires engineer testing.
