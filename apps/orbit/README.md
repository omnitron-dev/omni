# Orbit

A powerful infrastructure orchestration and configuration management system inspired by Ansible, written in TypeScript. Orbit provides a declarative approach to managing infrastructure with SSH-based task execution, playbooks, and inventory management.

## Features

- 📚 **Playbook System** - Declarative YAML-based playbooks for defining tasks
- 🖥️ **SSH Execution** - Secure remote command execution via SSH
- 📋 **Inventory Management** - Organize hosts and groups with variables
- 🔄 **Template Engine** - Mustache-based templating for configuration files
- 🔌 **Pluggable Tasks** - Extensible task system (shell, copy, template, etc.)
- 📊 **Metrics & Monitoring** - Prometheus metrics integration
- 🚨 **Alerting** - Built-in alerting service for notifications
- 📝 **Structured Logging** - JSON and text format logging
- 🛡️ **Error Handling** - Comprehensive error handling and recovery

## Installation

### As a CLI Tool

```bash
npm install -g @devgrid/orbit
# or
yarn global add @devgrid/orbit
```

### As a Library

```bash
npm install @devgrid/orbit
# or
yarn add @devgrid/orbit
```

## Quick Start

### 1. Create an Inventory File

Create `inventory.yml`:

```yaml
all:
  hosts:
    web1:
      ansible_host: 192.168.1.10
      ansible_user: ubuntu
      ansible_ssh_private_key_file: ~/.ssh/id_rsa
    web2:
      ansible_host: 192.168.1.11
      ansible_user: ubuntu
      ansible_ssh_private_key_file: ~/.ssh/id_rsa
  
  children:
    webservers:
      hosts:
        web1:
        web2:
      vars:
        nginx_port: 80
        app_name: myapp
```

### 2. Create a Playbook

Create `deploy.yml`:

```yaml
---
- name: Deploy Web Application
  hosts: webservers
  vars:
    app_version: "{{ app_version | default('latest') }}"
  
  tasks:
    - name: Update apt cache
      shell:
        cmd: sudo apt-get update
      
    - name: Install nginx
      shell:
        cmd: sudo apt-get install -y nginx
      
    - name: Copy nginx config
      copy:
        src: ./files/nginx.conf
        dest: /etc/nginx/sites-available/{{ app_name }}
        mode: '0644'
      
    - name: Enable site
      shell:
        cmd: |
          sudo ln -sf /etc/nginx/sites-available/{{ app_name }} /etc/nginx/sites-enabled/
          sudo nginx -t && sudo systemctl reload nginx
      
    - name: Deploy application
      shell:
        cmd: |
          cd /var/www/{{ app_name }}
          git pull origin main
          npm install
          npm run build
          pm2 restart {{ app_name }}
```

### 3. Run the Playbook

```bash
orbit playbook run deploy.yml -i inventory.yml
```

## CLI Commands

### Playbook Commands

```bash
# Run a playbook
orbit playbook run <playbook.yml> -i <inventory.yml>

# Run with extra variables
orbit playbook run deploy.yml -i inventory.yml -e app_version=v1.2.3

# Run with specific tags
orbit playbook run deploy.yml -i inventory.yml --tags deploy,config

# Check mode (dry run)
orbit playbook run deploy.yml -i inventory.yml --check

# Limit to specific hosts
orbit playbook run deploy.yml -i inventory.yml --limit web1,web2
```

### Inventory Commands

```bash
# List all hosts
orbit inventory list -i inventory.yml

# Show host details
orbit inventory show web1 -i inventory.yml

# Validate inventory
orbit inventory validate -i inventory.yml
```

### Ad-hoc Commands

```bash
# Run command on all hosts
orbit run -i inventory.yml -a "uptime"

# Run command on specific group
orbit run -i inventory.yml -g webservers -a "df -h"

# Copy file to hosts
orbit run -i inventory.yml -m copy -a "src=./file.txt dest=/tmp/"
```

## Playbook Structure

### Basic Playbook

```yaml
---
- name: Playbook Name
  hosts: target_hosts
  vars:
    variable1: value1
    variable2: value2
  
  tasks:
    - name: Task name
      module_name:
        param1: value1
        param2: value2
```

### Available Task Modules

#### Shell Module

Execute shell commands on remote hosts:

```yaml
- name: Run shell command
  shell:
    cmd: echo "Hello, World!"
    creates: /path/to/file  # Skip if file exists
    removes: /path/to/file  # Skip if file doesn't exist
    chdir: /path/to/dir     # Change directory before execution
```

#### Copy Module

Copy files to remote hosts:

```yaml
- name: Copy configuration file
  copy:
    src: ./files/app.conf
    dest: /etc/myapp/app.conf
    mode: '0644'
    owner: root
    group: root
    backup: yes  # Create backup of existing file
```

#### Template Module

Copy and process template files:

```yaml
- name: Deploy configuration from template
  template:
    src: ./templates/nginx.conf.j2
    dest: /etc/nginx/nginx.conf
    vars:
      server_name: "{{ ansible_host }}"
      port: "{{ nginx_port }}"
```

#### Composite Module

Group multiple tasks together:

```yaml
- name: Setup application
  composite:
    tasks:
      - name: Create directory
        shell:
          cmd: mkdir -p /opt/myapp
      
      - name: Copy files
        copy:
          src: ./app/
          dest: /opt/myapp/
```

## Variables and Templating

### Variable Precedence (highest to lowest)

1. Extra vars (`-e` flag)
2. Task vars
3. Playbook vars
4. Host vars
5. Group vars
6. Inventory vars

### Using Variables

```yaml
vars:
  app_name: myapp
  app_port: 3000

tasks:
  - name: Start application
    shell:
      cmd: pm2 start {{ app_name }} -- --port {{ app_port }}
```

### Templates

Orbit uses Mustache for templating:

```nginx
# nginx.conf template
server {
    listen {{ port }};
    server_name {{ server_name }};
    
    location / {
        proxy_pass http://localhost:{{ app_port }};
    }
}
```

## Configuration

### Orbit Configuration File

Create `.orbit.yml` in your project root:

```yaml
# Logging configuration
logLevel: info  # debug, info, warn, error
logFormat: json # json, text

# Task execution
maxConcurrency: 5
taskTimeout: 300000  # 5 minutes in ms

# SSH defaults
sshDefaults:
  connectTimeout: 10000
  keepaliveInterval: 5000
  readyTimeout: 5000

# Metrics
metricsEnabled: true
metricsPort: 9090
```

### Environment Variables

- `ORBIT_LOG_LEVEL` - Set log level
- `ORBIT_LOG_FORMAT` - Set log format
- `ORBIT_CONFIG` - Path to configuration file

## Advanced Features

### Conditional Execution

```yaml
tasks:
  - name: Install package on Ubuntu
    shell:
      cmd: apt-get install -y nginx
    when: ansible_distribution == "Ubuntu"
  
  - name: Install package on CentOS
    shell:
      cmd: yum install -y nginx
    when: ansible_distribution == "CentOS"
```

### Loops

```yaml
tasks:
  - name: Create multiple users
    shell:
      cmd: useradd {{ item }}
    with_items:
      - user1
      - user2
      - user3
```

### Error Handling

```yaml
tasks:
  - name: Try to start service
    shell:
      cmd: systemctl start myapp
    ignore_errors: yes
  
  - name: Fallback start method
    shell:
      cmd: /opt/myapp/start.sh
    when: last_task_failed
```

### Handlers

```yaml
handlers:
  - name: restart nginx
    shell:
      cmd: systemctl restart nginx

tasks:
  - name: Update nginx config
    copy:
      src: nginx.conf
      dest: /etc/nginx/nginx.conf
    notify: restart nginx
```

## Programmatic Usage

```typescript
import { Orbit } from '@devgrid/orbit';
import { Playbook } from '@devgrid/orbit/core/playbooks/playbook';

const orbit = new Orbit({
  logLevel: 'info',
  logFormat: 'json'
});

// Load inventory
await orbit.inventory.loadFromFile('./inventory.yml');

// Create and run playbook
const playbook = new Playbook({
  name: 'Deploy Application',
  hosts: 'webservers',
  tasks: [
    {
      name: 'Update code',
      module: 'shell',
      args: {
        cmd: 'cd /opt/app && git pull'
      }
    }
  ]
});

orbit.registerPlaybook('deploy', playbook);
const result = await playbook.run(orbit.context);
```

## Extending Orbit

### Custom Task Modules

```typescript
import { TaskModule, TaskResult } from '@devgrid/orbit/types';

export class CustomModule implements TaskModule {
  async execute(args: any, context: any): Promise<TaskResult> {
    // Your custom logic here
    return {
      success: true,
      changed: true,
      output: 'Task completed'
    };
  }
}

// Register module
orbit.context.moduleRegistry.register('custom', CustomModule);
```

### Custom Alerting Service

```typescript
import { AlertingService, Alert } from '@devgrid/orbit/types';

export class SlackAlertingService implements AlertingService {
  async sendAlert(alert: Alert): Promise<void> {
    // Send to Slack
  }
}

const orbit = new Orbit(config, new SlackAlertingService());
```

## Best Practices

1. **Use Version Control** - Keep playbooks and inventory in Git
2. **Encrypt Secrets** - Use environment variables or secret management
3. **Test Playbooks** - Use check mode before applying changes
4. **Modularize** - Break large playbooks into smaller, reusable ones
5. **Document Variables** - Document all variables and their purposes
6. **Use Tags** - Tag tasks for selective execution
7. **Monitor Execution** - Enable metrics for production use

## Troubleshooting

### Enable Debug Logging

```bash
orbit playbook run deploy.yml -i inventory.yml --debug
```

### Common Issues

1. **SSH Connection Failed**
   - Check SSH key permissions (600)
   - Verify host is reachable
   - Check username and port

2. **Task Timeout**
   - Increase timeout in configuration
   - Check for hanging commands
   - Use async execution for long tasks

3. **Variable Not Found**
   - Check variable name spelling
   - Verify variable scope
   - Use `default` filter for optional vars

## Contributing

Contributions are welcome! Please see our [Contributing Guide](../../CONTRIBUTING.md) for details.

## License

MIT © DevGrid