# SPDX-License-Identifier: AGPL-3.0-only
import hashlib
import pathlib
import subprocess
import tempfile

repo = pathlib.Path('/opt/lumo-test/packages')
repo.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory() as directory:
    root = pathlib.Path(directory)
    def write(path, value, mode=0o644):
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(value)
        target.chmod(mode)
    write('DEBIAN/control', '''Package: nginx
Version: 1.24.0-lumo.fixture1
Architecture: all
Maintainer: Lumo test suite
License: AGPL-3.0-only
Description: Original offline package fixture for Lumo uninstall tests
 This fixture is not the Nginx web server.
''')
    write('DEBIAN/conffiles', '/etc/nginx/nginx.conf\n')
    write('etc/nginx/nginx.conf', '# SPDX-License-Identifier: AGPL-3.0-only\n# Lumo offline package fixture\n')
    write('usr/sbin/nginx', '#!/bin/sh\n# SPDX-License-Identifier: AGPL-3.0-only\nprintf "Lumo offline nginx fixture\\n"\n', 0o755)
    for path in ['etc/nginx/conf.d', 'var/cache/nginx', 'var/lib/nginx', 'var/log/nginx']:
        (root / path).mkdir(parents=True, exist_ok=True)
    package = repo / 'nginx_1.24.0-lumo.fixture1_all.deb'
    subprocess.run(['dpkg-deb', '--build', '--root-owner-group', str(root), str(package)], check=True)
    control = subprocess.check_output(['dpkg-deb', '--field', str(package)], text=True)
    data = package.read_bytes()
    (repo / 'Packages').write_text(control + f'Filename: ./{package.name}\nSize: {len(data)}\nSHA256: {hashlib.sha256(data).hexdigest()}\n\n')
