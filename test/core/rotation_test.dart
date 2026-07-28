import 'package:flutter_test/flutter_test.dart';
import 'package:lukespics/data/models/member.dart';

void main() {
  final joinedAt = DateTime.utc(2026, 1, 1);

  LeagueMember member(
    String uid,
    int order, {
    MemberStatus status = MemberStatus.active,
  }) => LeagueMember(
    uid: uid,
    displayName: uid,
    role: LeagueRole.member,
    status: status,
    rotationOrder: order,
    joinedAt: joinedAt,
  );

  test('rotation skips inactive members', () {
    final rotation = PickerRotation([
      member('a', 0),
      member('b', 1, status: MemberStatus.inactive),
      member('c', 2),
    ]);

    expect(rotation.nextAfter('a')?.uid, 'c');
  });

  test('new member is appended after every historical rotation order', () {
    final rotation = PickerRotation([
      member('a', 4),
      member('b', 8, status: MemberStatus.inactive),
    ]).append(member('c', 0));

    expect(
      rotation.members.firstWhere((item) => item.uid == 'c').rotationOrder,
      9,
    );
  });
}
