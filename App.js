import React, { useState } from "react";
import axios from "axios";

function App() {
  const [text1, setText1] = useState("");
  const [text2, setText2] = useState("");
  const [result, setResult] = useState(null);

  const checkPlagiarism = async () => {
    const res = await axios.post("http://localhost:8000/check", {
      text1,
      text2
    });
    setResult(res.data);
  };

  return (
    <div style={{ padding: "20px" }}>
      <h2>Smart Plagiarism Detection (LLM + ML)</h2>

      <textarea
        rows="6"
        placeholder="Enter Text 1"
        onChange={(e) => setText1(e.target.value)}
      />

      <br /><br />

      <textarea
        rows="6"
        placeholder="Enter Text 2"
        onChange={(e) => setText2(e.target.value)}
      />

      <br /><br />

      <button onClick={checkPlagiarism}>Check Plagiarism</button>

      {result && (
        <div>
          <p>ML Score: {result.ml_score}%</p>
          <p>LLM Score: {result.llm_score}%</p>
          <p><b>Final Score: {result.final_score}%</b></p>
          <p>Explanation: {result.explanation}</p>
        </div>
      )}
    </div>
  );
}

export default App;
