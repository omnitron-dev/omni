import unittest
from unittest.mock import patch

from offline_probe import check_chain, check_isolation


class ServiceIsolation(unittest.TestCase):
    def test_only_loopback_is_accepted_with_network_socket_creation_restricted(self):
        for interfaces in (['lo'], [], ['lo', 'eth0']):
            stats = 'header\nheader\n' + ''.join('  ' + name + ': 0 0 0\n' for name in interfaces)
            with self.subTest(interfaces=interfaces), patch('offline_probe.os.geteuid', return_value=988), \
                    patch('offline_probe.os.getegid', return_value=980), \
                    patch('offline_probe.Path.read_text', side_effect=['CapEff:\t0\nNoNewPrivs:\t1\n', stats]), \
                    patch('socket.if_nameindex', side_effect=OSError(97, 'Address family not supported')):
                if interfaces == ['lo']:
                    check_isolation(988, 980)
                else:
                    with self.assertRaisesRegex(ValueError, 'loopback-only'):
                        check_isolation(988, 980)


class NativeHeaders(unittest.TestCase):
    def setUp(self):
        self.database = {'height': 103, 'tip': 'd' * 64, 'genesis': 'a' * 64,
                         'checkpointHeight': 98, 'checkpointHash': 'b' * 64}
        self.info = {'status': 'OK', 'nettype': 'mainnet', 'offline': True, 'height': 103,
                     'top_block_hash': 'd' * 64, 'incoming_connections_count': 0, 'outgoing_connections_count': 0}
        self.headers = {0: 'a' * 64, 98: 'b' * 64, 102: 'd' * 64}
        self.reads = []

    def rpc(self, method, params):
        if method == 'get_info':
            return self.info
        self.assertEqual(method, 'get_block_header_by_height')
        height = params['height']
        self.reads.append(height)
        return {'status': 'OK', 'block_header': {'height': height, 'hash': self.headers[height]}}

    def test_reads_the_actual_genesis_checkpoint_and_tip(self):
        self.assertEqual(check_chain(self.rpc, self.database)['height'], 103)
        self.assertEqual(self.reads, [0, 98, 102])

    def test_refuses_a_different_checkpoint_at_the_same_height(self):
        self.headers[98] = 'f' * 64
        with self.assertRaisesRegex(ValueError, 'header'):
            check_chain(self.rpc, self.database)

    def test_rejects_an_online_daemon_and_mismatched_state(self):
        for key, value in [('offline', False), ('incoming_connections_count', 1), ('outgoing_connections_count', 1),
                           ('nettype', 'stagenet'), ('height', 104), ('top_block_hash', 'e' * 64)]:
            with self.subTest(key=key):
                previous = self.info[key]
                self.info[key] = value
                with self.assertRaises(ValueError):
                    check_chain(self.rpc, self.database)
                self.info[key] = previous


if __name__ == '__main__':
    unittest.main()
