# Configuration Files

This directory contains JSON configuration files that are automatically created and managed by the Jira Dashboard application.

## Files

### `releases.json`
Stores release and milestone configuration data. This file is automatically created when you add your first release through the dashboard UI.

**Structure:**
```json
{
  "releases": [
    {
      "name": "N2026.R2",
      "milestones": {
        "DA": "2026-03-03",
        "KO": "2026-04-07",
        // ... more milestones
      }
    }
  ],
  "milestones": [
    {
      "id": "DA",
      "label": "Discovery Alignment",
      "fullName": "DISCOVERY ALIGNMENT",
      "color": "#185FA5"
    }
    // ... more milestone definitions
  ]
}
```

### `projects.json`
Stores custom projects and project settings (JQL overrides, enabled/disabled state). This file is automatically created when you add a custom project or modify project settings.

**Structure:**
```json
{
  "customProjects": [
    {
      "id": "cp_myproj",
      "name": "My Custom Project",
      "key": "MYPROJ",
      "color": "#185FA5",
      "category": "Custom",
      "jql": "project = MYPROJ AND fixVersion = N2026.R2"
    }
  ],
  "projectSettings": {
    "NFS": {
      "enabled": true,
      "jql": "custom JQL override for built-in project"
    },
    "BUGS": {
      "enabled": false,
      "removed": true
    }
  }
}
```

## Important Notes

- **Do not delete this folder** - The application will recreate it, but you may lose configurations
- **Backup your configs** - Copy `releases.json` to a safe location before major changes
- **Version control** - These files are gitignored by default to keep personal configs out of repos
- **Manual editing** - You can manually edit JSON files, but ensure valid JSON syntax
- **File permissions** - Ensure the Node.js process has read/write access to this directory

## Sharing Configurations

To share your release configuration with your team:

1. Copy `releases.json` to a shared location
2. Team members can copy it into their `config/` folder
3. Refresh the dashboard to load the new configuration

## Troubleshooting

**Config not loading:**
- Check that the proxy server is running (`node proxy.js`)
- Verify file permissions
- Check browser console for errors

**Config not saving:**
- Ensure the `config/` directory exists
- Check that proxy.js has write permissions
- Review server console logs for errors
