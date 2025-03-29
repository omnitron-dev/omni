[Unit]
Description=OMNITRON process manager
Documentation=https://omnitron.keymetrics.io/
After=network.target

[Service]
Type=forking
User=%USER%
LimitNOFILE=infinity
LimitNPROC=infinity
LimitCORE=infinity
Environment=PATH=%NODE_PATH%:/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin
Environment=OMNITRON_HOME=%HOME_PATH%
PIDFile=%HOME_PATH%/omnitron.pid
Restart=on-failure

ExecStart=%OMNITRON_PATH% resurrect
ExecReload=%OMNITRON_PATH% reload all
ExecStop=%OMNITRON_PATH% kill

[Install]
WantedBy=multi-user.target
