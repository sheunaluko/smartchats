/**
 * ProcessManager — Cortex Async Process System (Fork Architecture)
 *
 * Spawns background processes that run independently while the user
 * continues conversing. Each process is either a simple code execution
 * or a full sub-agent with its own LLM loop.
 */

import { EventEmitter } from 'events'
import type { SandboxExecutor } from './sandbox_interface.js'
import { DEFAULT_SANDBOX_TIMEOUT } from './sandbox_interface.js'
import type { SystemContextManager } from './system_context_manager.js'
import { SynchronousRunnerV2 } from './runner/synchronous_v2.js'

// ── Types ──

export type ProcessMode = 'execute' | 'agent'
export type ProcessStatus = 'running' | 'completed' | 'failed' | 'killed'
export type CompletionMode = 'immediate' | 'standard'

export interface ProcessOutputLine { ts: number; line: string }

export interface ProcessOutput {
    stdout: ProcessOutputLine[]
    stderr: ProcessOutputLine[]
}

export interface CortexProcessInfo {
    id: string
    name: string
    mode: ProcessMode
    status: ProcessStatus
    completionMode: CompletionMode
    startedAt: number
    finishedAt?: number
    exitCode?: number
    output: ProcessOutput
    result?: any
}

export interface ProcessSummary {
    process_id: string
    id: string
    name: string
    mode: ProcessMode
    status: ProcessStatus
    completionMode: CompletionMode
    startedAt: number
    finishedAt?: number
    exitCode?: number
    elapsed: number
    stdoutLines: number
    stderrLines: number
}

export interface ForkOptions {
    name: string
    mode: ProcessMode
    completionMode?: CompletionMode   // default: 'standard'
    code?: string                     // for 'execute' mode
    directive?: string                // for 'agent' mode — task instruction
    scm?: SystemContextManager        // optional custom SCM (for agent mode)
    maxLoops?: number                 // default: 4 (for agent mode)
}

// Factory type — app layer provides this so ProcessManager stays platform-agnostic
export type SandboxFactory = () => SandboxExecutor

// ── Internal type ──

interface CortexProcessInternal extends CortexProcessInfo {
    _sandbox: SandboxExecutor
    _abortController: AbortController
    _childCortex?: any
}

// ── ProcessManager ──

export interface ProcessIdleEvent {
    session_id: string
    session_name: string
    recent_output: any
}

export class ProcessManager extends EventEmitter {
    private processes: Map<string, CortexProcessInternal> = new Map()
    private parentCortex: any  // typed as Cortex but avoiding circular import
    private sandboxFactory: SandboxFactory
    private CortexClass: any   // constructor ref passed in to avoid circular import
    private log: any
    private idleQueue: ProcessIdleEvent[] = []

    constructor(parentCortex: any, sandboxFactory: SandboxFactory) {
        super()
        this.parentCortex = parentCortex
        this.sandboxFactory = sandboxFactory
        this.CortexClass = parentCortex.constructor
        this.log = parentCortex.log
    }

    async fork(opts: ForkOptions): Promise<string> {
        const id = `proc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const sandbox = this.sandboxFactory()
        await sandbox.initializePersistent()

        const proc: CortexProcessInternal = {
            id,
            name: opts.name,
            mode: opts.mode,
            status: 'running',
            completionMode: opts.completionMode || 'standard',
            startedAt: Date.now(),
            output: { stdout: [], stderr: [] },
            _sandbox: sandbox,
            _abortController: new AbortController(),
        }
        this.processes.set(id, proc)
        this.emitProcessEvent('process_spawned', proc)

        // Fire and forget — runs in background
        if (opts.mode === 'execute') {
            this.runExecuteMode(proc, opts.code || '')
        } else {
            this.runAgentMode(proc, opts)
        }

        return id
    }

    ps(): ProcessSummary[] {
        const summaries: ProcessSummary[] = []
        for (const proc of this.processes.values()) {
            summaries.push(this.toSummary(proc))
        }
        return summaries
    }

    read(processId: string, opts?: { stream?: 'stdout' | 'stderr'; last?: number }): ProcessOutput | null {
        const proc = this.processes.get(processId)
        if (!proc) return null

        const stream = opts?.stream
        const last = opts?.last

        let stdout = proc.output.stdout
        let stderr = proc.output.stderr

        if (stream === 'stdout') {
            stderr = []
        } else if (stream === 'stderr') {
            stdout = []
        }

        if (last && last > 0) {
            stdout = stdout.slice(-last)
            stderr = stderr.slice(-last)
        }

        return { stdout, stderr }
    }

    kill(processId: string): boolean {
        const proc = this.processes.get(processId)
        if (!proc || proc.status !== 'running') return false

        proc._abortController.abort()
        proc.status = 'killed'
        proc.finishedAt = Date.now()
        try { proc._sandbox.destroy() } catch (_) { /* ignore cleanup errors */ }

        this.emitProcessEvent('process_state_change', proc)
        return true
    }

    sendInput(processId: string, data: any): boolean {
        const proc = this.processes.get(processId)
        if (!proc || !proc._childCortex) return false
        proc._childCortex.handle_function_input(data)
        return true
    }

    getProcess(processId: string): CortexProcessInfo | undefined {
        const proc = this.processes.get(processId)
        if (!proc) return undefined
        // Return info without internal fields
        const { _sandbox, _abortController, ...info } = proc
        return info
    }

    destroy(): void {
        for (const [id, proc] of this.processes) {
            if (proc.status === 'running') {
                proc._abortController.abort()
                proc.status = 'killed'
                proc.finishedAt = Date.now()
            }
            try { proc._sandbox.destroy() } catch (_) { /* ignore */ }
        }
        this.processes.clear()
    }

    // ── Idle Queue ──

    queueIdle(event: ProcessIdleEvent): void {
        this.idleQueue.push(event)
    }

    flushIdleQueue(): ProcessIdleEvent[] {
        const queue = [...this.idleQueue]
        this.idleQueue = []
        if (queue.length > 0) {
            this.emit('process_idle_batch', { idle_sessions: queue, ts: Date.now() })
        }
        return queue
    }

    getIdleQueueLength(): number {
        return this.idleQueue.length
    }

    // ── Execute mode ──

    private async runExecuteMode(proc: CortexProcessInternal, code: string): Promise<void> {
        try {
            // Build sandbox context with parent's functions + stdout/stderr helpers
            const context = this.parentCortex.build_sandbox_context()

            // Add stdout/stderr helpers
            context.stdout = (line: string) => {
                this.appendStdout(proc, String(line))
            }
            context.stderr = (line: string) => {
                this.appendStderr(proc, String(line))
            }

            // Stream console.log output in real-time (not batched after execution)
            let cleanupStream: (() => void) | undefined
            if (proc._sandbox.setupEventStream) {
                cleanupStream = proc._sandbox.setupEventStream((event) => {
                    if (event.type === 'log') {
                        const p = event.payload as { args?: any[]; level?: string }
                        const text = p.args?.join(' ') || ''
                        if (p.level === 'error') {
                            this.appendStderr(proc, text)
                        } else {
                            this.appendStdout(proc, text)
                        }
                    }
                })
            }

            // Execute. Use the cortex-wide DEFAULT_SANDBOX_TIMEOUT (1 hour)
            // so forked execute-mode processes get the same ceiling as
            // regular agent code. The previous hardcoded 5min was an
            // oversight from before the constant was introduced — it
            // contradicted the fork_process system_msg which advertises
            // "timers" as a valid use case.
            const result = await proc._sandbox.execute(code, context, DEFAULT_SANDBOX_TIMEOUT)

            // Cleanup real-time stream
            if (cleanupStream) cleanupStream()

            // Map any remaining sandbox logs into stdout/stderr (fallback if no event stream)
            if (!cleanupStream && result.logs) {
                for (const log of result.logs) {
                    const text = log.args?.join(' ') || ''
                    if (log.level === 'error') {
                        this.appendStderr(proc, text)
                    } else {
                        this.appendStdout(proc, text)
                    }
                }
            }

            if (result.ok) {
                proc.result = result.data
                this.completeProcess(proc, 0)
            } else {
                proc.result = result.error
                this.appendStderr(proc, result.error || 'Execution failed')
                this.completeProcess(proc, 1)
            }

            // Emit execution event to parent insights
            const parentInsights = this.parentCortex.insights
            if (parentInsights) {
                parentInsights.addEvent('process_execute', {
                    process_id: proc.id,
                    process_name: proc.name,
                    status: result.ok ? 'success' : 'error',
                    duration_ms: Date.now() - proc.startedAt,
                    code_length: code.length,
                    error: result.ok ? undefined : result.error,
                }, { tags: ['subprocess'] }).catch(() => {})
            }
        } catch (err: any) {
            this.appendStderr(proc, err.message || String(err))
            this.completeProcess(proc, 1)
        }
    }

    // ── Agent mode ──

    private async runAgentMode(proc: CortexProcessInternal, opts: ForkOptions): Promise<void> {
        let childInsights: any = null
        try {
            const Cortex = this.CortexClass

            const snapshot = this.parentCortex.getStateSnapshot()

            // Create child SCM
            let childScm: SystemContextManager
            if (opts.scm) {
                childScm = opts.scm
            } else {
                childScm = this.parentCortex.scm.clone()
                // Remove modules not needed for background tasks
                childScm.remove_module('display_functions')
                childScm.remove_module('process_functions')
                // Add task-focused intro
                childScm.update_module('intro', {
                    system_msg: `You are a background sub-agent running task: "${opts.name}".
Your directive: ${opts.directive || 'Complete the assigned task.'}
You are running as a background process. Your output is captured as process stdout/stderr, not shown directly to the user.
Use console.log() to emit progress to stdout. Complete the task and respond when done.`,
                })
            }

            // Add request_input function module to child SCM
            childScm.add_module({
                id: 'process_input',
                name: 'Process Input',
                position: 15,
                functions: [{
                    name: 'request_input',
                    description: 'Request input from the parent agent. Blocks until a response is provided. Pass any data describing what you need.',
                    parameters: { data: 'any' },
                    return_type: 'any',
                    enabled: true,
                    fn: async (ops: any) => {
                        const payload = ops.params?.data ?? ops.params
                        this.emit('process_needs_input', { processId: proc.id, data: payload, ts: Date.now() })
                        this.appendStdout(proc, `[request_input] Waiting for input...`)
                        const response = await ops.util.get_user_data()
                        this.appendStdout(proc, `[request_input] Got response`)
                        return response
                    },
                }],
            })

            // Create scoped insights for child process tracing
            childInsights = this.parentCortex.insights
            if (childInsights?.createScope) {
                childInsights = childInsights.createScope({
                    name: `process:${opts.name}`,
                    metadata: { process_id: proc.id, process_name: opts.name },
                    tags: ['subprocess'],
                })
            }

            // Create child Cortex — same runner as parent for identical LLM call paths
            const child = new Cortex({
                model: this.parentCortex.model,
                name: `${this.parentCortex.name}:${opts.name}`,
                provider: this.parentCortex.provider,
                sandbox: proc._sandbox,
                apiBaseUrl: this.parentCortex.apiBaseUrl,
                llmCallFn: this.parentCortex.llmCallFn,
                utilities: this.parentCortex.utilities,
                scm: childScm,
                runner: this.parentCortex.runner,
                insights: childInsights,
            })

            // Swap to SynchronousRunnerV2 — child processes don't need streaming
            child.setRunner(new SynchronousRunnerV2())

            // Store child ref for input routing
            proc._childCortex = child

            // Inject snapshot state
            child.CortexRAM = { ...snapshot.cortexRAM }
            child.workspace = { ...snapshot.workspace }

            // Wire child events → process stdout
            child.on('event', (evt: any) => {
                this.emit('process_agent_event', { processId: proc.id, event: evt, ts: Date.now() })
                if (evt.type === 'thought') {
                    this.appendStdout(proc, `[thought] ${evt.thought}`)
                } else if (evt.type === 'log') {
                    this.appendStdout(proc, evt.log || evt.message || '')
                } else if (evt.type === 'sandbox_log') {
                    if (evt.level === 'error') {
                        this.appendStderr(proc, evt.args?.join(' ') || '')
                    } else {
                        this.appendStdout(proc, evt.args?.join(' ') || '')
                    }
                } else if (evt.type === 'response_complete') {
                    this.appendStdout(proc, `[response] ${evt.response}`)
                }
            })

            // Run the agent loop
            child.add_user_text_input(opts.directive || opts.name)
            await child.run_llm(opts.maxLoops || 4)

            // Capture result
            proc.result = child.last_result
            if (childInsights?.end) childInsights.end()
            this.completeProcess(proc, 0)
        } catch (err: any) {
            if (childInsights?.end) childInsights.end()
            this.appendStderr(proc, err.message || String(err))
            this.completeProcess(proc, 1)
        }
    }

    // ── Helpers ──

    private completeProcess(proc: CortexProcessInternal, exitCode: number): void {
        if (proc.status !== 'running') return // already killed/completed

        proc.status = exitCode === 0 ? 'completed' : 'failed'
        proc.exitCode = exitCode
        proc.finishedAt = Date.now()
        try { proc._sandbox.destroy() } catch (_) { /* ignore */ }

        // Inject result into parent's message history
        this.parentCortex.add_user_data_input({
            process_id: proc.id,
            name: proc.name,
            exit_code: exitCode,
            result: proc.result,
            stdout_tail: proc.output.stdout.slice(-5).map((l: ProcessOutputLine) => l.line),
            stderr_tail: proc.output.stderr.slice(-3).map((l: ProcessOutputLine) => l.line),
        }, 'process_result')

        this.emitProcessEvent('process_complete', proc)
    }

    private appendStdout(proc: CortexProcessInternal, line: string): void {
        proc.output.stdout.push({ ts: Date.now(), line })
        this.emit('process_output', {
            processId: proc.id,
            stream: 'stdout',
            line,
            ts: Date.now(),
        })
    }

    private appendStderr(proc: CortexProcessInternal, line: string): void {
        proc.output.stderr.push({ ts: Date.now(), line })
        this.emit('process_output', {
            processId: proc.id,
            stream: 'stderr',
            line,
            ts: Date.now(),
        })
    }

    private emitProcessEvent(type: string, proc: CortexProcessInternal): void {
        const summary = this.toSummary(proc)
        this.emit(type, { ...summary, completionMode: proc.completionMode })
    }

    private toSummary(proc: CortexProcessInternal): ProcessSummary {
        return {
            process_id: proc.id,
            id: proc.id,
            name: proc.name,
            mode: proc.mode,
            status: proc.status,
            completionMode: proc.completionMode,
            startedAt: proc.startedAt,
            finishedAt: proc.finishedAt,
            exitCode: proc.exitCode,
            elapsed: (proc.finishedAt || Date.now()) - proc.startedAt,
            stdoutLines: proc.output.stdout.length,
            stderrLines: proc.output.stderr.length,
        }
    }
}
