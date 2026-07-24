import { useEffect, useState } from "react";
import { api, type Application } from "../lib/api";

const STATUSES = ["shortlist", "applied", "interview", "offer", "rejected"] as const;

export default function Tracker() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ company: "", role: "", location: "", source: "", atsPlatform: "" });

  async function refresh() {
    setLoading(true);
    setApplications(await api.tracker.list());
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

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
