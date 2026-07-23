import { NavLink, Route, Routes } from "react-router-dom";
import CvEditor from "./pages/CvEditor";
import JobBoard from "./pages/JobBoard";
import Tracker from "./pages/Tracker";
import "./App.css";

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>jobhunt</h1>
        <nav>
          <NavLink to="/" end>
            CV Editor
          </NavLink>
          <NavLink to="/jobs">Job Board</NavLink>
          <NavLink to="/tracker">Tracker</NavLink>
        </nav>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<CvEditor />} />
          <Route path="/jobs" element={<JobBoard />} />
          <Route path="/tracker" element={<Tracker />} />
        </Routes>
      </main>
    </div>
  );
}
