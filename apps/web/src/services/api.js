async function request(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Request failed');
    }
    return res.json();
}
export function runWorkflow(graph) {
    return request('/api/run', { graph });
}
export function resumeWorkflow(runId, input) {
    return request('/api/resume', { runId, input });
}
