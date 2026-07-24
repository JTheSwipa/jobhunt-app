const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface ToggleNode {
  key: string;
  kind: "section" | "item";
  sectionKey: string;
  sectionLabel: string;
  itemLabel?: string;
  hidden: boolean;
}

export interface MasterCv {
  id: string;
  name: string;
  data: unknown;
}

export interface CvProfile {
  id: string;
  masterCvId: string;
  name: string;
  visibility: Record<string, boolean>;
  order: string[];
  style: "default" | "compact";
}

export interface Application {
  id: string;
  dateApplied?: string | null;
  company: string;
  role: string;
  location?: string | null;
  source?: string | null;
  atsPlatform?: string | null;
  status: string;
  responseDate?: string | null;
  responseType?: string | null;
  notes?: string | null;
  jobListingId?: string | null;
}

export interface JobListing {
  id: string;
  title: string;
  company: string;
  location?: string | null;
  country?: string | null;
  site: string;
  datePosted?: string | null;
  jobUrl: string;
  status: string;
}

export interface TailoringSuggestion {
  key: string;
  label: string;
  suggestedHidden: boolean;
  reason: string;
}

export const api = {
  cv: {
    getMaster: (name = "master") => request<MasterCv>(`/cv/master?name=${encodeURIComponent(name)}`),
    saveMaster: (name: string, data: unknown) =>
      request<MasterCv>("/cv/master", { method: "PUT", body: JSON.stringify({ name, data }) }),
    toggles: (masterId: string) => request<ToggleNode[]>(`/cv/master/${masterId}/toggles`),
    renderOrder: () => request<string[]>("/cv/render-order"),
    listProfiles: (masterCvId: string) => request<CvProfile[]>(`/cv/profiles?masterCvId=${masterCvId}`),
    createProfile: (body: Omit<CvProfile, "id">) =>
      request<CvProfile>("/cv/profiles", { method: "POST", body: JSON.stringify(body) }),
    updateProfile: (id: string, body: Partial<Omit<CvProfile, "id" | "masterCvId">>) =>
      request<CvProfile>(`/cv/profiles/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    deleteProfile: (id: string) => request<void>(`/cv/profiles/${id}`, { method: "DELETE" }),
    render: (id: string) => request<{ htmlPath: string; pdfPath: string }>(`/cv/profiles/${id}/render`, { method: "POST" }),
    suggest: (id: string, targetRole: string) =>
      request<TailoringSuggestion[]>(`/cv/profiles/${id}/suggest`, { method: "POST", body: JSON.stringify({ targetRole }) }),
    previewUrl: (id: string) => `${BASE}/cv/profiles/${id}/preview`,
  },
  tracker: {
    list: () => request<Application[]>("/tracker"),
    create: (body: Partial<Application>) => request<Application>("/tracker", { method: "POST", body: JSON.stringify(body) }),
    update: (id: string, body: Partial<Application>) =>
      request<Application>(`/tracker/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    remove: (id: string) => request<void>(`/tracker/${id}`, { method: "DELETE" }),
  },
  jobs: {
    list: () => request<JobListing[]>("/jobs"),
    search: (body: { source: "indeed"; terms?: string[]; locations?: string[]; days?: number }) =>
      request<{ found: number; added: number; skipped: number }>("/jobs/search", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    setStatus: (id: string, status: string) =>
      request<JobListing>(`/jobs/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  },
};
