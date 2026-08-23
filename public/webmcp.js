/**
 * WebMCP tool registration. Runs on page load so agents can discover site actions
 * even before Angular bootstraps. No-ops when navigator.modelContext is absent.
 */
(function registerNostriaWebMcp() {
  var nav = typeof navigator === 'undefined' ? null : navigator;
  if (!nav) return;

  var mc = nav.modelContext || nav.modelContextProtocol;
  if (!mc) return;

  function textResult(text) {
    return { content: [{ type: 'text', text: String(text) }] };
  }

  function go(path) {
    try {
      window.location.assign(path);
    } catch (_err) {
      /* ignore */
    }
    return textResult('Navigating to ' + path);
  }

  var tools = [
    {
      name: 'search',
      description: 'Search Nostria for people, posts, and articles.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query, npub, note id, or NIP-05 name'
          }
        },
        required: ['query']
      },
      execute: function (input) {
        var query = input && input.query ? String(input.query) : '';
        return go('/search?q=' + encodeURIComponent(query));
      }
    },
    {
      name: 'open_profile',
      description: 'Open a Nostria profile by npub, nprofile, hex pubkey, or username.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'npub, nprofile, hex pubkey, or NIP-05 username'
          }
        },
        required: ['id']
      },
      execute: function (input) {
        var id = input && input.id ? String(input.id).trim() : '';
        if (!id) return textResult('id is required');
        if (id.indexOf('@') !== -1) {
          return go('/u/' + encodeURIComponent(id.split('@')[0]));
        }
        if (/^[a-z0-9._-]+$/i.test(id) && id.indexOf('npub') !== 0 && id.indexOf('nprofile') !== 0 && id.length < 64) {
          return go('/u/' + encodeURIComponent(id));
        }
        return go('/p/' + encodeURIComponent(id));
      }
    },
    {
      name: 'open_post',
      description: 'Open a Nostria post by note id, nevent, or event hex.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'note1..., nevent1..., or 64-char hex' }
        },
        required: ['id']
      },
      execute: function (input) {
        var id = input && input.id ? String(input.id).trim() : '';
        if (!id) return textResult('id is required');
        return go('/e/' + encodeURIComponent(id));
      }
    },
    {
      name: 'navigate',
      description: 'Navigate to a public Nostria path such as /discover, /music, or /articles.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute site path beginning with /'
          }
        },
        required: ['path']
      },
      execute: function (input) {
        var path = input && input.path ? String(input.path) : '/';
        if (path.charAt(0) !== '/') path = '/' + path;
        if (path.indexOf('//') === 0 || path.indexOf('://') !== -1) {
          return textResult('Refusing off-site navigation');
        }
        return go(path);
      }
    }
  ];

  try {
    if (typeof mc.provideContext === 'function') {
      mc.provideContext({ tools: tools });
    }
  } catch (_provideErr) {
    /* ignore */
  }

  try {
    if (typeof mc.registerTool === 'function') {
      for (var i = 0; i < tools.length; i++) {
        mc.registerTool(tools[i]);
      }
    }
  } catch (_registerErr) {
    /* ignore */
  }
})();
