// ignore_for_file: subtype_of_sealed_class

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lukespics/data/repositories/firebase_league_repository.dart';
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
      when(() => query.get()).thenAnswer((_) async => result);
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
}
