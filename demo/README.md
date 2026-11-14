# A three-minute WatDatMean demo

1. Open `score.ts`. Hover over `private score: number = 0;` and read the free declaration breakdown. Click **Open learning panel**. Click individual syntax pieces for more detail.
   In `dashboard.ts`, also hover over `board.addCompletedTasks(3);` or `console.log(weeklySummary(3));`. The instant breakdown explains the receiver, member access, method/function, and arguments—including how the nested call’s result is passed to `console.log`. No API key is needed.
2. Put the cursor on the name `calculatePoints` and press **Ctrl+Alt+E** (**Cmd+Alt+E** on Mac). Connect an OpenAI, Anthropic, or Groq API key with **Connect provider**.
3. Click **Explain this code**. Switch context to **In this project** and request another explanation to include its references. Try **Getting up to speed** for an experienced-developer explanation.
4. Open **Another example** and request a new example. Expand an unfamiliar concept and ask for a deeper explanation.
5. Open **Try it yourself**. Replace `tasks * POINTS_PER_TASK` with `tasks + POINTS_PER_TASK` in the **Your version** box. Keep the rest of the selected function intact.
6. Click **See what changes**. Follow the links to `dashboard.ts` and `score.test.ts`. Click **Explain the change · AI** to get predictions grounded in those references.
7. Optionally choose **Use this code** and confirm. The panel reloads your edited code and stays on **Try it yourself**, ready for another change. **Start over** resets the draft to the current code in your file. Three tasks would now produce 13 points instead of 30; zero tasks would produce 10 instead of 0. The test file captures these cases. Undo the change to restore the demo.

The diff and reference preview works without a key. AI actions use your provider's API billing. Requests do not run code or tests.

To run the demo checks from the repository root:

```sh
npx tsc -p demo
node demo/out/score.test.js
```
