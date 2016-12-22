#!/bin/bash
#this script installs the service on linux systems.
#first we find the newest init mechanism, then we install

echo "installing NooBaa"
instdate=$(date -u +"%m-%d-%H:%M")
echo $(date)

function verify_command_run {
        $@ >> /var/log/noobaa_service_${instdate} 2>&1
        local rc=$?
        if [ $rc -ne 0 ]; then
                echo "NooBaa installation failed"
                exit 1
        fi
}

PATH=/usr/local/noobaa:$PATH;
mkdir /usr/local/noobaa/logs
chmod 777 /usr/local/noobaa/remove_service.sh
/usr/local/noobaa/remove_service.sh ignore_rc >> /var/log/noobaa_service_${instdate} 2>&1
if [ -f /usr/bin/systemctl ] || [ -f /bin/systemctl ]; then
  echo "Systemd detected. Installing service"
  cp /usr/local/noobaa/src/agent/system_d.conf /etc/systemd/system/multi-user.target.wants/noobaalocalservice.service
  echo "Updating systemctl"
  verify_command_run systemctl daemon-reload
  systemctl enable noobaalocalservice >> /var/log/noobaa_service_${instdate} 2>&1
  echo "Starting Service"
  verify_command_run systemctl start noobaalocalservice
  verify_command_run systemctl daemon-reload
elif [[ -d /etc/init ]]; then
  echo "Upstart detected. Creating startup script"
  cp /usr/local/noobaa/src/agent/upstart.conf /etc/init/noobaalocalservice.conf
  sleep 1
  echo "Starting Service"
  verify_command_run initctl start noobaalocalservice
elif [[ -d /etc/init.d ]]; then
  echo "System V detected. Installing service"
  verify_command_run /usr/local/noobaa/node /usr/local/noobaa/src/agent/agent_linux_installer
  type chkconfig &> /dev/null
  if [ $? -eq 0 ]; then
    verify_command_run chkconfig noobaalocalservice on
  else
    verify_command_run update-rc.d noobaalocalservice enable
  fi
  echo "Starting Service"
  verify_command_run service noobaalocalservice start
else
  echo "ERROR: Cannot detect init mechanism, NooBaa installation failed"
  exit 1
fi

echo "NooBaa installation completed successfully"
