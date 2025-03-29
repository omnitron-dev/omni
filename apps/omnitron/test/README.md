
# Installing development version

```bash
$ npm install git://github.com/Unitech/omnitron.git#development -g
```

# Redhat

```
$ sudo yum install git wget emacs
$ sudo yum groupinstall "Development Tools"
$ wget -qO- https://raw.github.com/creationix/nvm/master/install.sh | sh
$ # put .bash_profile content to .bashrc
$ source .bashrc
$ nvm install v0.11.10
$ nvm alias default 0.11.10
$ npm install omnitron -g
$ # OR
$ npm install git://github.com/Unitech/omnitron.git#development -g
```

# CentOS

```
$ yum install git wget emacs
$ wget -qO- https://raw.github.com/creationix/nvm/master/install.sh | sh
$
```

## Remove init script

sudo update-rc.d -f omnitron-init.sh remove
```
$ chkconfig --del omnitron-init.sh
$ chkconfig --add omnitron-init.sh
```

gyp WARN EACCES user "root" does not have permission to create dev dir :
https://github.com/TooTallNate/node-gyp/issues/126
-> add --unsafe-perm

# .omnitron

Doesnt work

```
$ sudo sh -c 'echo "export OMNITRON_HOME=/var/" >> /etc/profile'
$ sudo mkdir /var/.omnitron; chown -R tknew:tknew /var/.omnitron
```
