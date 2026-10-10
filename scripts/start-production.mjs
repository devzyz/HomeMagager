// Explicit production entry point. Configuration validation happens before binding a port.
process.env.NODE_ENV = 'production'
await import('../apps/server/dist/server.js')
