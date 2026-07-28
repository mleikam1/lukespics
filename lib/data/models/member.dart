enum LeagueRole { owner, commissioner, member }

enum MemberStatus { active, inactive, left }

final class LeagueMember {
  const LeagueMember({
    required this.uid,
    required this.displayName,
    required this.role,
    required this.status,
    required this.rotationOrder,
    required this.joinedAt,
    this.photoUrl,
    this.eligibleFromWeekId,
  });

  final String uid;
  final String displayName;
  final Uri? photoUrl;
  final LeagueRole role;
  final MemberStatus status;
  final int rotationOrder;
  final DateTime joinedAt;
  final String? eligibleFromWeekId;

  bool get isActive => status == MemberStatus.active;

  LeagueMember copyWith({
    MemberStatus? status,
    int? rotationOrder,
    String? eligibleFromWeekId,
  }) => LeagueMember(
    uid: uid,
    displayName: displayName,
    photoUrl: photoUrl,
    role: role,
    status: status ?? this.status,
    rotationOrder: rotationOrder ?? this.rotationOrder,
    joinedAt: joinedAt,
    eligibleFromWeekId: eligibleFromWeekId ?? this.eligibleFromWeekId,
  );
}

final class PickerRotation {
  const PickerRotation(this.members);

  final List<LeagueMember> members;

  List<LeagueMember> get orderedActive {
    final active = members.where((member) => member.isActive).toList();
    active.sort((a, b) => a.rotationOrder.compareTo(b.rotationOrder));
    return active;
  }

  LeagueMember? nextAfter(String currentUid) {
    final active = orderedActive;
    if (active.isEmpty) return null;
    final currentIndex = active.indexWhere(
      (member) => member.uid == currentUid,
    );
    if (currentIndex < 0) return active.first;
    return active[(currentIndex + 1) % active.length];
  }

  PickerRotation append(LeagueMember member) {
    final nextOrder = members.isEmpty
        ? 0
        : members
                  .map((existing) => existing.rotationOrder)
                  .reduce((a, b) => a > b ? a : b) +
              1;
    return PickerRotation([
      ...members,
      member.copyWith(rotationOrder: nextOrder),
    ]);
  }
}
