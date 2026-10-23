import { appendFileSync } from 'node:fs'

function record(kind, input, output) {
  appendFileSync(process.env.PLOT_RUN + '/hc-tools.jsonl', JSON.stringify({ kind, input, output, observedAt: Date.now() }) + '\n')
}

export default {
  id: 'plot.passive-observer',
  server: async () => ({
    'tool.execute.before': async (input, output) => record('before', input, output),
    'tool.execute.after': async (input, output) => record('after', input, output),
    event: async ({ event }) => {
      if (['session.created', 'session.idle', 'session.error', 'session.deleted', 'message.part.updated', 'agent.delegation'].includes(event.type)) {
        record('event', event, null)
      }
    },
  }),
}
