import { useEffect, useState } from "react";
import { api, type JobListing } from "../lib/api";

export default function JobBoard() {
  const [listings, setListings] = useState<JobListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setListings(await api.jobs.list());
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function runSearch() {
    setSearching(true);
    setSearchMsg(null);
    try {
      const result = await api.jobs.search({ source: "indeed", days: 14 });
      setSearchMsg(`Found ${result.found}, added ${result.added} new (${result.skipped} already tracked)`);
      refresh();
    } catch (err) {
      setSearchMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }

  async function setStatus(id: string, status: string) {
    await api.jobs.setStatus(id, status);
    refresh();
  }

  return (
    <section>
      <h2>Job Board</h2>

      <div className="panel row">
        <button type="button" onClick={runSearch} disabled={searching}>
          {searching ? "Searching Indeed…" : "Scan Indeed (last 14 days)"}
        </button>
        {searchMsg && <span>{searchMsg}</span>}
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : listings.length === 0 ? (
        <p>No listings yet — run a search above.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Company</th>
              <th>Location</th>
              <th>Site</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {listings.map((l) => (
              <tr key={l.id}>
                <td>
                  <a href={l.jobUrl} target="_blank" rel="noreferrer">
                    {l.title}
                  </a>
                </td>
                <td>{l.company}</td>
                <td>{l.location ?? "—"}</td>
                <td>
                  <span className="pill">{l.site}</span>
                </td>
                <td>
                  <span className={`status-${l.status}`}>{l.status}</span>
                </td>
                <td className="row">
                  {["shortlist", "skip", "applied"].map((s) => (
                    <button key={s} type="button" onClick={() => setStatus(l.id, s)} disabled={l.status === s}>
                      {s}
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
