// ignore_for_file: subtype_of_sealed_class

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lukespics/data/repositories/firebase_league_repository.dart';
import 'package:lukespics/data/repositories/league_repository.dart';
import 'package:mocktail/mocktail.dart';

class _MockFirebaseAuth extends Mock implements FirebaseAuth {}

class _MockUser extends Mock implements User {}

class _MockFirebaseFirestore extends Mock implements FirebaseFirestore {}

class _MockFirebaseFunctions extends Mock implements FirebaseFunctions {}

class _MockQuery extends Mock implements Query<Map<String, dynamic>> {}

class _MockQuerySnapshot extends Mock
    implements QuerySnapshot<Map<String, dynamic>> {}

class _MockQueryDocumentSnapshot extends Mock
    implements QueryDocumentSnapshot<Map<String, dynamic>> {}

class _MockDocumentSnapshot extends Mock
    implements DocumentSnapshot<Map<String, dynamic>> {}

class _MockDocumentReference extends Mock
    implements DocumentReference<Map<String, dynamic>> {}

class _MockCollectionReference extends Mock
    implements CollectionReference<Map<String, dynamic>> {}

QueryDocumentSnapshot<Map<String, dynamic>> membership({
  required String leagueId,
  Object? joinedAt,
}) {
  final snapshot = _MockQueryDocumentSnapshot();
  final membershipReference = _MockDocumentReference();
  final membersCollection = _MockCollectionReference();
  final leagueReference = _MockDocumentReference();
  when(() => snapshot.reference).thenReturn(membershipReference);
  when(() => snapshot.data()).thenReturn({'joinedAt': joinedAt});
  when(() => membershipReference.parent).thenReturn(membersCollection);
  when(() => membersCollection.parent).thenReturn(leagueReference);
  when(() => leagueReference.id).thenReturn(leagueId);
  return snapshot;
}

void main() {
  test(
    'active arenas rank newest joinedAt first with safe deterministic dedupe',
    () async {
      final auth = _MockFirebaseAuth();
      final user = _MockUser();
      final firestore = _MockFirebaseFirestore();
      final query = _MockQuery();
      final result = _MockQuerySnapshot();
      when(() => auth.currentUser).thenReturn(user);
      when(() => user.uid).thenReturn('user-1');
      when(() => firestore.collectionGroup('members')).thenReturn(query);
      when(() => query.where('uid', isEqualTo: 'user-1')).thenReturn(query);
      when(() => query.where('status', isEqualTo: 'active')).thenReturn(query);
      when(
        () => query.get(const GetOptions(source: Source.server)),
      ).thenAnswer((_) async => result);
      final memberships = [
        membership(
          leagueId: 'league-c',
          joinedAt: Timestamp.fromDate(DateTime.utc(2026, 3, 1)),
        ),
        membership(leagueId: 'league-z'),
        membership(
          leagueId: 'league-a',
          joinedAt: Timestamp.fromDate(DateTime.utc(2026, 1, 1)),
        ),
        membership(
          leagueId: 'league-b',
          joinedAt: Timestamp.fromDate(DateTime.utc(2026, 4, 1)),
        ),
        membership(
          leagueId: 'league-a',
          joinedAt: Timestamp.fromDate(DateTime.utc(2026, 4, 1)),
        ),
        membership(leagueId: 'league-y', joinedAt: 'malformed'),
      ];
      when(() => result.docs).thenReturn(memberships);
      final repository = FirebaseLeagueRepository(
        auth: auth,
        firestore: firestore,
        functions: _MockFirebaseFunctions(),
      );

      await expectLater(
        repository.findActiveLeagueIds(),
        completion([
          'league-a',
          'league-b',
          'league-c',
          'league-y',
          'league-z',
        ]),
      );
    },
  );

  test('restore reads league, members, and week from the server', () async {
    final firestore = _MockFirebaseFirestore();
    final leagues = _MockCollectionReference();
    final leagueReference = _MockDocumentReference();
    final leagueSnapshot = _MockDocumentSnapshot();
    final weeks = _MockCollectionReference();
    final weekReference = _MockDocumentReference();
    final weekSnapshot = _MockDocumentSnapshot();
    final members = _MockCollectionReference();
    final membersQuery = _MockQuery();
    final membersSnapshot = _MockQuerySnapshot();
    final memberSnapshot = _MockQueryDocumentSnapshot();
    const server = GetOptions(source: Source.server);

    when(() => firestore.collection('leagues')).thenReturn(leagues);
    when(() => leagues.doc('league-1')).thenReturn(leagueReference);
    when(
      () => leagueReference.get(server),
    ).thenAnswer((_) async => leagueSnapshot);
    when(() => leagueSnapshot.id).thenReturn('league-1');
    when(() => leagueSnapshot.data()).thenReturn({
      'name': 'Server Arena',
      'timezone': 'America/Chicago',
      'currentWeekId': 'week-0001',
      'currentPickerUid': 'owner',
      'settings': const <String, Object?>{},
    });

    when(() => leagueReference.collection('weeks')).thenReturn(weeks);
    when(() => weeks.doc('week-0001')).thenReturn(weekReference);
    when(() => weekReference.get(server)).thenAnswer((_) async => weekSnapshot);
    when(() => weekSnapshot.id).thenReturn('week-0001');
    when(() => weekSnapshot.data()).thenReturn({
      'sequentialNumber': 1,
      'label': 'Week 1',
      'pickerUid': 'owner',
      'status': 'draft',
    });

    when(() => leagueReference.collection('members')).thenReturn(members);
    when(() => members.orderBy('rotationOrder')).thenReturn(membersQuery);
    when(
      () => membersQuery.get(server),
    ).thenAnswer((_) async => membersSnapshot);
    when(() => membersSnapshot.docs).thenReturn([memberSnapshot]);
    when(() => memberSnapshot.id).thenReturn('owner');
    when(() => memberSnapshot.data()).thenReturn({
      'uid': 'owner',
      'displayName': 'Server Owner',
      'role': 'owner',
      'status': 'active',
      'rotationOrder': 0,
      'joinedAt': Timestamp.fromDate(DateTime.utc(2026, 8, 27)),
    });

    final repository = FirebaseLeagueRepository(
      auth: _MockFirebaseAuth(),
      firestore: firestore,
      functions: _MockFirebaseFunctions(),
    );

    final league = await repository.getLeague('league-1');
    final week = await repository.getWeek('league-1', 'week-0001');
    final roster = await repository.getMembers('league-1');

    expect(league?.name, 'Server Arena');
    expect(week?.label, 'Week 1');
    expect(roster.single.displayName, 'Server Owner');
    verify(() => leagueReference.get(server)).called(1);
    verify(() => weekReference.get(server)).called(1);
    verify(() => membersQuery.get(server)).called(1);
  });

  test('server restore failures become safe repository errors', () async {
    final firestore = _MockFirebaseFirestore();
    final leagues = _MockCollectionReference();
    final leagueReference = _MockDocumentReference();
    const server = GetOptions(source: Source.server);
    when(() => firestore.collection('leagues')).thenReturn(leagues);
    when(() => leagues.doc('league-1')).thenReturn(leagueReference);
    when(() => leagueReference.get(server)).thenThrow(
      FirebaseException(plugin: 'cloud_firestore', code: 'unavailable'),
    );
    final repository = FirebaseLeagueRepository(
      auth: _MockFirebaseAuth(),
      firestore: firestore,
      functions: _MockFirebaseFunctions(),
    );

    await expectLater(
      repository.getLeague('league-1'),
      throwsA(
        isA<RepositoryException>()
            .having((error) => error.code, 'code', 'unavailable')
            .having(
              (error) => error.safeMessage,
              'safeMessage',
              contains('reconnecting'),
            ),
      ),
    );
  });
}
