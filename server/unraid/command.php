<?php
// The docker command the Docker tab's Apply runs for a template, read by Unraid's own
// template reader with the globals CreateDocker.php sets (Q127 127a). Usage: php command.php <template>
$docroot = '/usr/local/emhttp';
chdir($docroot);
require_once "$docroot/plugins/dynamix.docker.manager/include/DockerClient.php";
require_once "$docroot/plugins/dynamix.docker.manager/include/Helpers.php";
$var = parse_ini_file('state/var.ini');
$custom = DockerUtil::custom();
$subnet = DockerUtil::network($custom);
$cpus = DockerUtil::cpus();
[$cmd] = xmlToCommand($argv[1]);
echo $cmd;
