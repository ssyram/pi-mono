import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FSM = ROOT / '.runtime/fsm-src/target/release'
HC = Path('/Users/ssyram/bin/opencode')
MOCK = ROOT / '.runtime/mock-src/target/release/mock-llm-server'


def environment(run):
    env = {key: value for key, value in os.environ.items() if key in ('LANG', 'LC_ALL', 'SHELL', 'USER')}
    env.update({'HOME': str(run / 'home'), 'OPENCODE_TEST_HOME': str(run / 'home'),
                'TMPDIR': str(run / 'tmp'), 'OPENCODE_TEST_MANAGED_CONFIG_DIR': str(run / 'managed'),
                'OPENCODE_DB': str(run / 'data/hc.db'), 'XDG_CONFIG_HOME': str(run / 'config'),
                'XDG_DATA_HOME': str(run / 'data'), 'XDG_CACHE_HOME': str(run / 'cache'),
                'XDG_STATE_HOME': str(run / 'state'), 'OPENCODE_CONFIG_DIR': str(run / 'config/opencode'),
                'OPENCODE_DISABLE_PROJECT_CONFIG': 'true', 'OPENCODE_DISABLE_DEFAULT_PLUGINS': 'true',
                'OPENCODE_DISABLE_MODELS_FETCH': 'true', 'OPENCODE_DISABLE_AUTOUPDATE': 'true',
                'OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS': 'true',
                'OPENCODE_DISABLE_EXTERNAL_SKILLS': 'true', 'OPENCODE_DISABLE_CLAUDE_CODE': 'true',
                'OPENCODE_DISABLE_LSP_DOWNLOAD': 'true', 'OPENCODE_DISABLE_FFF': 'true',
                'OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER': 'true',
                'npm_config_cache': str(run / 'npm-cache'), 'npm_config_userconfig': str(run / 'npmrc'),
                'npm_config_ignore_scripts': 'true', 'npm_config_audit': 'false', 'npm_config_fund': 'false',
                'FSM_DATA_DIR': str(run / 'fsm'), 'FSM_STOP_ANALYSIS': '1',
                'FSM_CLIENT_LOG': str(run / 'fsm-client.log'), 'PLOT_RUN': str(run),
                'PLOT_REAL_HOOK': str(FSM / 'mcp-server-fsm-hook'),
                'PATH': str(run / 'bin') + ':' + str(FSM) + ':/usr/bin:/bin:/usr/sbin:/sbin'})
    for name in ('home', 'config/opencode/node_modules/@opencode-ai', 'data', 'cache', 'state', 'fsm',
                 'bin', 'work', 'http', 'model-inputs', 'hooks', 'captures', 'api-observations', 'tmp', 'managed', 'npm-cache', 'fsm-states', 'hc-tool-parts'):
        (run / name).mkdir(parents=True, exist_ok=True)
    (run / 'npmrc').write_text('ignore-scripts=true\naudit=false\nfund=false\nregistry=http://127.0.0.1:1\n')
    subprocess.run(['/usr/bin/git', 'init', '-q', str(run / 'work')], env=env, check=True)
    (run / 'bin/opencode').symlink_to(HC)
    (run / 'bin/python3').symlink_to(sys.executable)
    (run / 'bin/rg').symlink_to(ROOT / '.runtime/tool-bin/rg')
    plugin = ROOT / '.runtime/hc-src/packages/plugin'
    (run / 'config/opencode/node_modules/@opencode-ai/plugin').symlink_to(plugin)
    dependencies = {'@opencode-ai/plugin': 'file:' + str(plugin)}
    (run / 'config/opencode/package.json').write_text(json.dumps({'private': True, 'dependencies': dependencies}))
    (run / 'config/opencode/package-lock.json').write_text(json.dumps({'lockfileVersion': 3, 'packages': {'': {'dependencies': dependencies}}}))
    return env


def configuration(run, model_port):
    return {'model': 'plot/plot-model', 'small_model': 'plot/plot-model', 'enabled_providers': ['plot'],
            'provider': {'plot': {'npm': '@ai-sdk/openai-compatible', 'name': 'Local plot only',
                                  'options': {'baseURL': f'http://127.0.0.1:{model_port}/plot/v1', 'apiKey': 'local-no-secret'},
                                  'models': {'plot-model': {'name': 'plot-model', 'limit': {'context': 200000, 'output': 8192}}}}},
            'plugin': [str(ROOT / 'src/hc_observer.js'),
                       [str(ROOT / '.runtime/fsm-src/opencode-plugin/fsm-plugin.js'),
                        {'hookBin': str(ROOT / 'src/hook_observer.sh'), 'hookTimeoutSeconds': 900}]],
            'permission': {'*': 'allow'},
            'mcp': {'fsm': {'type': 'local', 'command': [str(FSM / 'mcp-server-fsm-client')], 'enabled': True}}}
