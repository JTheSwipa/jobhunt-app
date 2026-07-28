import { useEffect, useState } from "react";
import { api, type Application, type CvRender } from "../lib/api";

const STATUSES = ["shortlist", "applied", "interview", "offer", "rejected"] as const;

export default function Tracker() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [renders, setRenders] = useState<CvRender[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ company: "", role: "", location: "", source: "", atsPlatform: "" });

  async function refresh() {
    setLoading(true);
    const [apps, rs] = await Promise.all([api.tracker.list(), api.cv.listRenders()]);
    setApplications(apps);
    setRenders(rs);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  // Attaching a render is what makes "which CV did I send to Acme?" answerable.
  // The row records the render, not the profile: profiles are mutable, so a
  // pointer at one would quietly start lying the next time it was edited.
  async function attachRender(id: string, cvRenderId: string) {
    await api.tracker.update(id, { cvRenderId: cvRenderId || null });
    refresh();
  }

  async function addRow(e: React.FormEvent) {
    e.preventDefault();
    if (!form.company || !form.role) return;
    await api.tracker.create({ ...form, dateApplied: new Date().toISOString() });
    setForm({ company: "", role: "", location: "", source: "", atsPlatform: "" });
    refresh();
  }

  async function updateStatus(id: string, status: string) {
    await api.tracker.update(id, { status });
    refresh();
  }

  async function remove(id: string) {
    await api.tracker.remove(id);
    refresh();
  }

  return (
    <section>
      <h2>Application Tracker</h2>

      <form className="panel row" onSubmit={addRow}>
        <input placeholder="Company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
        <input placeholder="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
        <input placeholder="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        <input placeholder="Source" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
        <input placeholder="ATS platform" value={form.atsPlatform} onChange={(e) => setForm({ ...form, atsPlatform: e.target.value })} />
        <button type="submit">Add application</button>
      </form>

      {loading ? (
        <p>Loading…</p>
      ) : applications.length === 0 ? (
        <p>No applications tracked yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Role</th>
              <th>Applied</th>
              <th>Status</th>
              <th>ATS</th>
              <th>CV sent</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {applications.map((a) => (
              <tr key={a.id}>
                <td>{a.company}</td>
                <td>{a.role}</td>
                <td>{a.dateApplied ? new Date(a.dateApplied).toLocaleDateString() : "—"}</td>
                <td>
                  <select value={a.status} onChange={(e) => updateStatus(a.id, e.target.value)}>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{a.atsPlatform ?? "—"}</td>
                <td>
                  {a.cvRender ? (
                    // profileName comes off the render itself, so this still
                    // reads correctly after that profile is renamed or deleted.
                    <a href={api.cv.renderPdfUrl(a.cvRender.id)} download title={a.cvRender.filename}>
                      {a.cvRender.profileName}
                      <span style={{ color: "var(--muted)" }}>
                        {" "}
                        · {new Date(a.cvRender.createdAt).toLocaleDateString()}
                      </span>
                    </a>
                  ) : renders.length === 0 ? (
                    <span style={{ color: "var(--muted)" }}>no renders yet</span>
                  ) : (
                    <select value="" onChange={(e) => attachRender(a.id, e.target.value)}>
                      <option value="">— attach —</option>
                      {renders.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.profileName} · {new Date(r.createdAt).toLocaleDateString()}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td>
                  <button type="button" onClick={() => remove(a.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
